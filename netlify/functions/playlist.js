/**
 * Team 8K — Playlist delivery function
 * Uses node-fetch + direct Supabase REST/Storage API calls
 * to avoid the @supabase/realtime-js WebSocket issue on Node 20.
 */

const https = require("https");

const M3U_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, User-Agent",
  "Content-Type":  "audio/x-mpegurl; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const EMPTY_M3U = "#EXTM3U\n";
const SLUG_RE   = /[a-f0-9]{24}/i;

// ── Minimal REST helper (no supabase-js, no WebSocket) ───────────────────

function sbFetch(url, serviceKey, path, opts = {}) {
  return fetch(`${url}/rest/v1${path}`, {
    ...opts,
    headers: {
      "apikey":        serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type":  "application/json",
      "Accept":        "application/json",
      ...(opts.headers || {}),
    },
  });
}

function sbStorage(url, serviceKey, storagePath) {
  // Service role uses /object/authenticated/<bucket>/<path>
  // storagePath from DB is already "user-uuid/playlist-id.m3u" — prepend bucket name
  const fullPath = storagePath.startsWith("edited-playlists/")
    ? storagePath
    : `edited-playlists/${storagePath}`;
  return fetch(`${url}/storage/v1/object/authenticated/${fullPath}`, {
    headers: {
      "apikey":        serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
    },
  });
}

// ── Handler ───────────────────────────────────────────────────────────────

exports.handler = async function (event) {

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: M3U_HEADERS, body: "" };
  }

  // Extract slug from path or rawUrl
  const src   = event.path || event.rawUrl || "";
  const match = src.match(SLUG_RE);
  const slug  = match ? match[0].toLowerCase() : null;

  console.log("[playlist] path:", event.path, "slug:", slug);

  if (!slug) {
    return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error("[playlist] missing env vars");
    return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
  }

  try {

    // ── 1. slug → edited_playlist_id ─────────────────────────────
    const r1 = await sbFetch(
      supabaseUrl, serviceKey,
      `/shared_playlists?slug=eq.${slug}&select=edited_playlist_id&limit=1`
    );
    const d1 = await r1.json();
    console.log("[playlist] shared_playlists result:", JSON.stringify(d1));

    if (!Array.isArray(d1) || d1.length === 0) {
      console.warn("[playlist] slug not found:", slug);
      return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
    }

    const editedId = d1[0].edited_playlist_id;

    // ── 2. edited_playlist_id → storage_path + name ──────────────
    const r2 = await sbFetch(
      supabaseUrl, serviceKey,
      `/edited_playlists?id=eq.${editedId}&select=name,storage_path,content&limit=1`
    );
    const d2 = await r2.json();
    console.log("[playlist] edited_playlists result:", JSON.stringify(d2));

    if (!Array.isArray(d2) || d2.length === 0) {
      console.warn("[playlist] playlist not found:", editedId);
      return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
    }

    const pl = d2[0];

    // ── 3. Fetch M3U from storage ─────────────────────────────────
    let content = pl.content || null;

    if (!content && pl.storage_path) {
      console.log("[playlist] downloading storage path:", pl.storage_path);
      const r3 = await sbStorage(supabaseUrl, serviceKey, pl.storage_path);
      console.log("[playlist] storage response status:", r3.status);
      if (!r3.ok) {
        console.error("[playlist] storage download failed:", r3.status, r3.statusText);
        return {
          statusCode: 200, headers: M3U_HEADERS,
          body: "#EXTM3U\n#EXTINF:-1,Error: please re-save your playlist in the editor\nhttp://localhost\n",
        };
      }
      content = await r3.text();
    }

    if (!content) {
      return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
    }

    // ── 4. Parse valid #EXTINF + URL pairs only ───────────────────
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
        "Content-Disposition": `inline; filename="${(pl.name || "playlist").replace(/[^a-z0-9]/gi, "-")}.m3u"`,
        "X-Channel-Count": String(count),
      },
      body: out.join("\n") + "\n",
    };

  } catch (err) {
    console.error("[playlist] error:", err?.message || err);
    return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
  }
};
