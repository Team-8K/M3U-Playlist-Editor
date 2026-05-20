/**
 * Team 8K — Playlist Serve Function
 *
 * Serves a user's edited playlist as raw M3U for TiviMate, IPTV Smarters,
 * OTT Navigator, VLC, or any M3U-compatible player.
 *
 * URL pattern:  /api/playlist/<slug>.m3u
 * Netlify route: /api/playlist/:slug → /.netlify/functions/playlist/:slug
 *
 * Security:
 * - slug is 24 cryptographically-random hex chars (12 bytes = 281 trillion combos)
 * - no enumeration possible via RLS or function logic
 * - uses Supabase service role key server-side — never exposed to the browser
 * - players receive HTTP 200 even on errors (Xtream/M3U player convention —
 *   non-200 causes players like TiviMate to permanently disable the playlist)
 *
 * Auto-refresh:
 * - players poll this URL on their own schedule (e.g. every 24h in TiviMate)
 * - the function always reads the latest file from storage
 * - users never need to update their player URL after re-editing
 */

const { createClient } = require("@supabase/supabase-js");

// ── Constants ─────────────────────────────────────────────────────────────

const M3U_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, User-Agent, Authorization",
  "Content-Type":  "audio/x-mpegurl; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "Pragma":        "no-cache",
};

const EMPTY_M3U = "#EXTM3U\n";

// Slug must be exactly 24 lowercase hex characters
const SLUG_RE = /^[a-f0-9]{24}$/;

// ── Handler ───────────────────────────────────────────────────────────────

exports.handler = async function (event) {

  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: M3U_HEADERS, body: "" };
  }

  // ── Extract and validate slug ─────────────────────────────────
  const raw   = event.path || "";
  // Matches /api/playlist/SLUG.m3u or /SLUG.m3u or /SLUG
  const match = raw.match(/\/([a-f0-9]{24})(?:\.m3u)?(?:\/.*)?$/i);

  if (!match || !SLUG_RE.test(match[1].toLowerCase())) {
    console.warn("playlist.js: invalid or missing slug in path:", raw);
    return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
  }

  const slug = match[1].toLowerCase();

  // ── Build Supabase client with service role key ───────────────
  // Service role bypasses RLS so we can read any row for valid slugs.
  // This key is only available server-side in Netlify env — never in the browser.
  const supabaseUrl     = process.env.VITE_SUPABASE_URL     || process.env.SUPABASE_URL;
  const supabaseService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseAnon    = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    console.error("playlist.js: missing SUPABASE_URL env var");
    return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
  }

  // Prefer service role; fall back to anon (anon works if RLS policy allows public reads)
  const supabaseKey = supabaseService || supabaseAnon;
  if (!supabaseKey) {
    console.error("playlist.js: missing Supabase key env var");
    return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  try {

    // ── Look up slug → edited_playlist_id ────────────────────────
    const { data: shared, error: se } = await supabase
      .from("shared_playlists")
      .select("edited_playlist_id")
      .eq("slug", slug)
      .maybeSingle();

    if (se || !shared) {
      console.warn("playlist.js: slug not found:", slug, se?.message);
      return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
    }

    // ── Fetch playlist metadata ───────────────────────────────────
    const { data: playlist, error: pe } = await supabase
      .from("edited_playlists")
      .select("content, storage_path, name")
      .eq("id", shared.edited_playlist_id)
      .maybeSingle();

    if (pe || !playlist) {
      console.warn("playlist.js: playlist not found for id:", shared.edited_playlist_id, pe?.message);
      return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
    }

    // ── Fetch M3U content ─────────────────────────────────────────
    let content = playlist.content;

    if (!content && playlist.storage_path) {
      const { data: file, error: fe } = await supabase.storage
        .from("edited-playlists")
        .download(playlist.storage_path);

      if (fe || !file) {
        console.error("playlist.js: storage download failed:", fe?.message);
        return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
      }
      content = await file.text();
    }

    if (!content) {
      console.warn("playlist.js: no content for playlist id:", shared.edited_playlist_id);
      return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
    }

    // ── Parse and serve only valid #EXTINF + URL pairs ────────────
    // Strips disabled channels, blank lines, and orphan entries.
    const lines   = content.split("\n");
    const output  = ["#EXTM3U"];
    let   pending = "";

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

    const body     = output.join("\n") + "\n";
    const filename = (playlist.name || "playlist")
      .replace(/[^a-z0-9]/gi, "-").toLowerCase().replace(/-+/g, "-");
    const count    = (output.length - 1) / 2;

    console.log(`playlist.js: served ${count} channels for slug ${slug} ("${playlist.name}")`);

    return {
      statusCode: 200,
      headers: {
        ...M3U_HEADERS,
        "Content-Disposition": `inline; filename="${filename}.m3u"`,
        "X-Channel-Count": String(count),
      },
      body,
    };

  } catch (err) {
    console.error("playlist.js: unexpected error:", err);
    return { statusCode: 200, headers: M3U_HEADERS, body: EMPTY_M3U };
  }
};
