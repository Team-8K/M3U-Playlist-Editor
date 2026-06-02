/**
 * Team 8K — Shared Playlist Serve Function
 * Serves a saved edited playlist as raw M3U for TiviMate / Kodi / VLC
 *
 * URL pattern (user-facing): /api/playlist/SLUG.m3u
 * Netlify redirect:          /api/* → /.netlify/functions/:splat
 * So this function is invoked as: /.netlify/functions/playlist/SLUG.m3u
 * event.path will be:             /playlist/SLUG.m3u  OR  /SLUG.m3u
 *
 * TiviMate behaviour (per EPGMaster research):
 *  - Sends GET requests
 *  - Must receive HTTP 200 even on errors — non-200 causes player to disable playlist
 *  - Content-Type must be audio/x-mpegurl
 */

const { createClient } = require("@supabase/supabase-js");

exports.handler = async function (event) {
  // TiviMate and most players need a plain 200 with M3U content-type.
  // Even errors should return 200 with an empty/minimal M3U so the player
  // doesn't permanently disable the playlist URL.
  const M3U_HEADERS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, User-Agent",
    "Content-Type":  "audio/x-mpegurl; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  };

  const emptyM3U = "#EXTM3U\n";

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: M3U_HEADERS, body: "" };
  }

  // ── Extract slug from path ────────────────────────────────────
  // Possible paths: /playlist/SLUG.m3u  |  /SLUG.m3u  |  /SLUG
  const raw   = event.path || "";
  const match = raw.match(/\/([a-fA-F0-9]{12,})(?:\.m3u)?(?:\/.*)?$/);
  if (!match) {
    console.error("playlist.js: could not extract slug from path:", raw);
    return { statusCode: 200, headers: M3U_HEADERS, body: emptyM3U };
  }
  const slug = match[1];

  // ── Supabase client ───────────────────────────────────────────
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("playlist.js: missing Supabase env vars");
    return { statusCode: 200, headers: M3U_HEADERS, body: emptyM3U };
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // ── Look up shared playlist by slug ───────────────────────────
    const { data: shared, error: se } = await supabase
      .from("shared_playlists")
      .select("edited_playlist_id")
      .eq("slug", slug)
      .maybeSingle();

    if (se || !shared) {
      console.error("playlist.js: slug not found:", slug, se?.message);
      return { statusCode: 200, headers: M3U_HEADERS, body: emptyM3U };
    }

    // ── Fetch edited playlist content ─────────────────────────────
    const { data: playlist, error: pe } = await supabase
      .from("edited_playlists")
      .select("content, storage_path, name")
      .eq("id", shared.edited_playlist_id)
      .maybeSingle();

    if (pe || !playlist) {
      console.error("playlist.js: playlist not found for id:", shared.edited_playlist_id, pe?.message);
      return { statusCode: 200, headers: M3U_HEADERS, body: emptyM3U };
    }

    let content = playlist.content;

    // Fall back to storage if inline content not present
    if (!content && playlist.storage_path) {
      const { data: file, error: fe } = await supabase.storage
        .from("edited-playlists")
        .download(playlist.storage_path);

      if (fe || !file) {
        console.error("playlist.js: storage download failed:", fe?.message);
        return { statusCode: 200, headers: M3U_HEADERS, body: emptyM3U };
      }
      content = await file.text();
    }

    if (!content) {
      console.error("playlist.js: playlist has no content, id:", shared.edited_playlist_id);
      return { statusCode: 200, headers: M3U_HEADERS, body: emptyM3U };
    }

    // ── Filter to enabled channels only ───────────────────────────
    // The stored M3U may contain disabled channels (lines starting with #).
    // We serve only valid stream entries (pairs of #EXTINF + URL lines).
    const lines   = content.split("\n");
    const output  = ["#EXTM3U"];
    let   pending = "";   // holds the #EXTINF line while we check the next

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("#EXTM3U")) continue;

      if (trimmed.startsWith("#EXTINF")) {
        pending = trimmed;
      } else if (pending && (trimmed.startsWith("http://") || trimmed.startsWith("https://"))) {
        output.push(pending);
        output.push(trimmed);
        pending = "";
      } else {
        pending = "";   // skip orphan lines
      }
    }

    const m3uContent = output.join("\n") + "\n";
    const filename   = (playlist.name || "playlist")
      .replace(/[^a-z0-9]/gi, "-").toLowerCase();

    console.log(`playlist.js: serving ${(output.length - 1) / 2} channels for slug ${slug}`);

    return {
      statusCode: 200,
      headers: {
        ...M3U_HEADERS,
        "Content-Disposition": `inline; filename="${filename}.m3u"`,
      },
      body: m3uContent,
    };

  } catch (err) {
    console.error("playlist.js: unexpected error:", err);
    return { statusCode: 200, headers: M3U_HEADERS, body: emptyM3U };
  }
};

