/**
 * Team 8K — Playlist delivery
 *
 * Permanent URL: https://yoursite.netlify.app/api/playlist/{playlist-id}.m3u
 *
 * The playlist UUID is the identifier — no random slugs, no extra tables.
 * On every player refresh, reads channels_json from edited_playlists and
 * generates fresh M3U text on the fly.
 */

const M3U_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, User-Agent",
  "Content-Type":  "audio/x-mpegurl; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

// UUID pattern
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

exports.handler = async function (event) {

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: M3U_HEADERS, body: "" };
  }

  // Extract playlist UUID from path
  // e.g. /api/playlist/fbd96839-5d1b-4117-ae01-f68a0a81fdd6.m3u
  const src   = event.path || "";
  const match = src.match(UUID_RE);
  const id    = match ? match[0].toLowerCase() : null;

  console.log("[playlist] path:", src, "id:", id);

  if (!id) {
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

    // Read channels_json and name directly from edited_playlists by UUID
    const res  = await fetch(
      `${supabaseUrl}/rest/v1/edited_playlists?id=eq.${id}&select=name,channels_json&limit=1`,
      { headers }
    );
    const data = await res.json();
    console.log("[playlist] result:", JSON.stringify(data).substring(0, 300));

    if (!Array.isArray(data) || !data[0]) {
      console.warn("[playlist] playlist not found:", id);
      return { statusCode: 200, headers: M3U_HEADERS, body: "#EXTM3U\n" };
    }

    const { name, channels_json } = data[0];

    if (!channels_json || !Array.isArray(channels_json) || channels_json.length === 0) {
      console.warn("[playlist] no channels_json for:", id);
      return { statusCode: 200, headers: M3U_HEADERS, body: "#EXTM3U\n" };
    }

    // Generate M3U
    const lines = ["#EXTM3U"];

    for (const ch of channels_json) {
      if (!ch.enabled) continue;
      if (!ch.url)     continue;

      const attrs = [];
      if (ch.tvg_id)   attrs.push(`tvg-id="${ch.tvg_id}"`);
      if (ch.tvg_logo) attrs.push(`tvg-logo="${ch.tvg_logo}"`);
      if (ch.category) attrs.push(`group-title="${ch.category}"`);

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
