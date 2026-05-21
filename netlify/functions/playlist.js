/**
 * Team 8K — Playlist Serve Function
 *
 * Serves a user's edited playlist as raw M3U for TiviMate, IPTV Smarters,
 * OTT Navigator, VLC, or any M3U-compatible player.
 *
 * URL pattern:  /api/playlist/<slug>.m3u
 */

const { createClient } = require("@supabase/supabase-js");

const M3U_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, User-Agent, Authorization",
  "Content-Type":  "audio/x-mpegurl; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Pragma":        "no-cache",
};

const EMPTY_M3U = "#EXTM3U\n";
const SLUG_RE   = /^[a-f0-9]{24}$/;

exports.handler = async function (event) {

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: M3U_HEADERS, body: "" };
  }

  // ── Extract and validate slug ─────────────────────────────────
  // event.path contains the full request path e.g. /api/playlist/b593d62dcc2a58b46b6aadfe.m3u
  const raw   = event.path || "";
  console.log("[playlist] incoming path:", raw);

  const match = raw.match(/\/([a-f0-9]{24})(?:\.m3u)?(?:\/.*)?$/i);

  if (!match || !SLUG_RE.test(match[1].toLowerCase())) {
    console.warn("[playlist] invalid or missing slug in path:", raw);
    return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
  }

  const slug = match[1].toLowerCase();
  console.log("[playlist] extracted slug:", slug);

  // ── Require service role key ──────────────────────────────────
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error("[playlist] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
    // Return an informative M3U comment so you can see the error in player logs
    return {
      statusCode: 200,
      headers: M3U_HEADERS,
      body: "#EXTM3U\n#EXTINF:-1,Error: server misconfiguration - contact admin\nhttp://localhost/error\n",
    };
  }

  // Service role bypasses RLS entirely — no need for public policies on storage
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  try {

    // ── 1. Slug → edited_playlist_id ─────────────────────────────
    const { data: shared, error: se } = await supabase
      .from("shared_playlists")
      .select("edited_playlist_id")
      .eq("slug", slug)
      .maybeSingle();

    if (se) {
      console.error("[playlist] DB error looking up slug:", slug, se.message);
      return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
    }
    if (!shared) {
      console.warn("[playlist] slug not found:", slug);
      return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
    }

    // ── 2. edited_playlist_id → metadata ─────────────────────────
    const { data: playlist, error: pe } = await supabase
      .from("edited_playlists")
      .select("content, storage_path, name, enabled_count")
      .eq("id", shared.edited_playlist_id)
      .maybeSingle();

    if (pe) {
      console.error("[playlist] DB error fetching playlist:", shared.edited_playlist_id, pe.message);
      return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
    }
    if (!playlist) {
      console.warn("[playlist] playlist row not found for id:", shared.edited_playlist_id);
      return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
    }
    if (!playlist.storage_path && !playlist.content) {
      console.warn("[playlist] playlist has no content or storage_path — user needs to re-save in Editor");
      return {
        statusCode: 200,
        headers: M3U_HEADERS,
        body: "#EXTM3U\n#EXTINF:-1,Playlist empty - please open the editor and re-save your playlist\nhttp://localhost/empty\n",
      };
    }

    // ── 3. Fetch M3U content from storage ────────────────────────
    let content = playlist.content;

    if (!content && playlist.storage_path) {
      console.log("[playlist] downloading from storage:", playlist.storage_path);

      const { data: file, error: fe } = await supabase.storage
        .from("edited-playlists")
        .download(playlist.storage_path);

      if (fe) {
        console.error("[playlist] storage download error:", fe.message, "path:", playlist.storage_path);
        return {
          statusCode: 200,
          headers: M3U_HEADERS,
          body: "#EXTM3U\n#EXTINF:-1,Error loading playlist - please open the editor and re-save\nhttp://localhost/error\n",
        };
      }
      if (!file) {
        console.error("[playlist] storage returned null file for path:", playlist.storage_path);
        return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
      }

      content = await file.text();
    }

    if (!content || content.trim().length < 10) {
      console.warn("[playlist] content is empty or too short after fetch");
      return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
    }

    // ── 4. Parse and serve only valid #EXTINF + URL pairs ─────────
    const lines  = content.split("\n");
    const output = ["#EXTM3U"];
    let pending  = "";

    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("#EXTM3U")) continue;

      if (t.startsWith("#EXTINF")) {
        pending = t;
      } else if (pending && (t.startsWith("http://") || t.startsWith("https://"))) {
        output.push(pending);
        output.push(t);
        pending = "";
      } else {
        pending = "";
      }
    }

    const channelCount = (output.length - 1) / 2;

    if (channelCount === 0) {
      console.warn("[playlist] parsed 0 channels from content length:", content.length);
      return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
    }

    const body     = output.join("\n") + "\n";
    const filename = (playlist.name || "playlist")
      .replace(/[^a-z0-9]/gi, "-").toLowerCase().replace(/-+/g, "-");

    console.log(`[playlist] served ${channelCount} channels for slug ${slug} ("${playlist.name}")`);

    return {
      statusCode: 200,
      headers: {
        ...M3U_HEADERS,
        "Content-Disposition": `inline; filename="${filename}.m3u"`,
        "X-Channel-Count":     String(channelCount),
      },
      body,
    };

  } catch (err) {
    console.error("[playlist] unexpected error:", err?.message || err);
    return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
  }
};
