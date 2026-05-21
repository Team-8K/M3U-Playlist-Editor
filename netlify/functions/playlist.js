const { createClient } = require("@supabase/supabase-js");

const M3U_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, User-Agent",
  "Content-Type":  "audio/x-mpegurl; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const EMPTY_M3U = "#EXTM3U\n";
const SLUG_RE   = /[a-f0-9]{24}/i;

exports.handler = async function (event) {

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: M3U_HEADERS, body: "" };
  }

  // ── Extract slug from the raw URL ─────────────────────────────
  // Use rawUrl (full URL string) as fallback — most reliable across Netlify routing
  const pathSources = [
    event.path,
    event.rawUrl,
    event.rawQuery ? null : null,
  ].filter(Boolean);

  let slug = null;
  for (const src of pathSources) {
    const m = src.match(SLUG_RE);
    if (m) { slug = m[0].toLowerCase(); break; }
  }

  console.log("[playlist] path:", event.path, "| rawUrl:", event.rawUrl, "| slug:", slug);

  if (!slug) {
    return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
  }

  // ── Supabase client — service role required ───────────────────
  const url        = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error("[playlist] missing env vars — VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return {
      statusCode: 200, headers: M3U_HEADERS,
      body: "#EXTM3U\n#EXTINF:-1,Configuration error - contact admin\nhttp://localhost\n",
    };
  }

  const sb = createClient(url, serviceKey, {
    auth:     { persistSession: false },
    realtime: { transport: null },      // disable WebSocket — not needed in a serverless function
    global:   { fetch: fetch },
  });

  try {

    // ── 1. slug → edited_playlist_id ─────────────────────────────
    const { data: shared, error: e1 } = await sb
      .from("shared_playlists")
      .select("edited_playlist_id")
      .eq("slug", slug)
      .maybeSingle();

    if (e1)      { console.error("[playlist] slug lookup error:", e1.message); return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U }; }
    if (!shared) { console.warn("[playlist] slug not found:", slug);            return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U }; }

    // ── 2. edited_playlist_id → storage_path ─────────────────────
    const { data: pl, error: e2 } = await sb
      .from("edited_playlists")
      .select("name, content, storage_path")
      .eq("id", shared.edited_playlist_id)
      .maybeSingle();

    if (e2)  { console.error("[playlist] playlist lookup error:", e2.message); return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U }; }
    if (!pl) { console.warn("[playlist] playlist not found:", shared.edited_playlist_id); return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U }; }

    console.log("[playlist] found playlist:", pl.name, "| storage_path:", pl.storage_path);

    // ── 3. Fetch content ──────────────────────────────────────────
    let content = pl.content || null;

    if (!content && pl.storage_path) {
      const { data: file, error: e3 } = await sb.storage
        .from("edited-playlists")
        .download(pl.storage_path);

      if (e3 || !file) {
        console.error("[playlist] storage download failed:", e3?.message, "path:", pl.storage_path);
        return {
          statusCode: 200, headers: M3U_HEADERS,
          body: "#EXTM3U\n#EXTINF:-1,Playlist file not found - please re-save in the editor\nhttp://localhost\n",
        };
      }
      content = await file.text();
    }

    if (!content) {
      console.warn("[playlist] no content available");
      return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
    }

    // ── 4. Parse #EXTINF + URL pairs ─────────────────────────────
    const out     = ["#EXTM3U"];
    let   pending = "";

    for (const raw of content.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#EXTM3U")) continue;
      if (line.startsWith("#EXTINF")) {
        pending = line;
      } else if (pending && (line.startsWith("http://") || line.startsWith("https://"))) {
        out.push(pending, line);
        pending = "";
      } else {
        pending = "";
      }
    }

    const count = (out.length - 1) / 2;
    console.log("[playlist] serving", count, "channels for", pl.name);

    return {
      statusCode: 200,
      headers: {
        ...M3U_HEADERS,
        "Content-Disposition": `inline; filename="${(pl.name || "playlist").replace(/[^a-z0-9]/gi,"-")}.m3u"`,
        "X-Channel-Count": String(count),
      },
      body: out.join("\n") + "\n",
    };

  } catch (err) {
    console.error("[playlist] unexpected error:", err?.message || err);
    return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
  }
};
