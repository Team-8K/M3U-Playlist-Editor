/**
 * Team 8K — Playlist delivery
 *
 * Permanent URL: https://yoursite.netlify.app/api/playlist/SLUG.m3u
 *
 * On every player refresh:
 *   1. Look up slug → edited_playlist_id  (shared_playlists table)
 *   2. Read channels_json from edited_playlists
 *   3. Generate and stream M3U text — no storage, no signed URLs
 *
 * The URL never changes. Edits appear automatically on next player refresh.
 */

const M3U_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, User-Agent",
  "Content-Type":  "audio/x-mpegurl; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const SLUG_RE = /[a-f0-9]{24}/i;

exports.handler = async function (event) {

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: M3U_HEADERS, body: "" };
  }

  // ── Extract slug ──────────────────────────────────────────────
  const src   = event.path || "";
  const match = src.match(SLUG_RE);
  const slug  = match ? match[0].toLowerCase() : null;

  console.log("[playlist] path:", src, "slug:", slug);

  if (!slug) {
    return { statusCode: 200, headers: M3U_HEADERS, body: "#EXTM3U\n" };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error("[playlist] missing env vars");
    return { statusCode: 200, headers: M3U_HEADERS, body: "#EXTM3U\n" };
  }

  const headers = {
    "apikey":        serviceKey,
    "Authorization": `Bearer ${serviceKey}`,
    "Content-Type":  "application/json",
    "Accept":        "application/json",
  };

  try {

    // ── 1. slug → edited_playlist_id ─────────────────────────────
    const r1  = await fetch(
      `${supabaseUrl}/rest/v1/shared_playlists?slug=eq.${slug}&select=edited_playlist_id&limit=1`,
      { headers }
    );
    const d1 = await r1.json();
    console.log("[playlist] shared lookup:", JSON.stringify(d1));

    if (!Array.isArray(d1) || !d1[0]?.edited_playlist_id) {
      console.warn("[playlist] slug not found:", slug);
      return { statusCode: 200, headers: M3U_HEADERS, body: "#EXTM3U\n" };
    }

    const editedId = d1[0].edited_playlist_id;

    // ── 2. Read channels_json + name ──────────────────────────────
    const r2  = await fetch(
      `${supabaseUrl}/rest/v1/edited_playlists?id=eq.${editedId}&select=name,channels_json&limit=1`,
      { headers }
    );
    const d2 = await r2.json();
    console.log("[playlist] playlist lookup:", JSON.stringify(d2).substring(0, 200));

    if (!Array.isArray(d2) || !d2[0]) {
      console.warn("[playlist] playlist not found:", editedId);
      return { statusCode: 200, headers: M3U_HEADERS, body: "#EXTM3U\n" };
    }

    const { name, channels_json } = d2[0];

    if (!channels_json || !Array.isArray(channels_json) || channels_json.length === 0) {
      console.warn("[playlist] no channels_json for:", editedId);
      return { statusCode: 200, headers: M3U_HEADERS, body: "#EXTM3U\n" };
    }

    // ── 3. Generate M3U from channel data ─────────────────────────
    const lines = ["#EXTM3U"];

    for (const ch of channels_json) {
      if (!ch.enabled) continue;
      if (!ch.url) continue;

      // Build #EXTINF line
      const attrs = [];
      if (ch.tvg_id)    attrs.push(`tvg-id="${ch.tvg_id}"`);
      if (ch.tvg_logo)  attrs.push(`tvg-logo="${ch.tvg_logo}"`);
      if (ch.category)  attrs.push(`group-title="${ch.category}"`);

      lines.push(`#EXTINF:-1 ${attrs.join(" ")},${ch.name}`);
      lines.push(ch.url);
    }

    const count = (lines.length - 1) / 2;
    console.log(`[playlist] serving ${count} channels for "${name}"`);

    return {
      statusCode: 200,
      headers: {
        ...M3U_HEADERS,
        "Content-Disposition": `inline; filename="${(name || "playlist").replace(/[^a-z0-9]/gi, "-")}.m3u"`,
        "X-Channel-Count": String(count),
      },
      body: lines.join("\n") + "\n",
    };

  } catch (err) {
    console.error("[playlist] error:", err?.message || err);
    return { statusCode: 200, headers: M3U_HEADERS, body: "#EXTM3U\n" };
  }
};

