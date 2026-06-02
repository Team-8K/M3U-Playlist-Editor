/**
 * Team 8K — Shared Playlist Serve Function
 * Serves a saved edited playlist as raw M3U for TiviMate / Kodi / VLC
 *
 * URL pattern (user-facing): /api/playlist/SLUG.m3u
 * Netlify redirect:          /api/* → /.netlify/functions/:splat
 * So this function is invoked as: /.netlify/functions/playlist/SLUG.m3u
 *
 * Flow:
 *  1. Look up slug → edited_playlist_id in shared_playlists
 *  2. Fetch source M3U live from source_playlists.url
 *  3. Apply edits_json diff (disable, delete, rename, recategory, reorder, add)
 *  4. Serve the result as audio/x-mpegurl
 *
 * Falls back to the stored content column if source is unavailable or
 * edits_json is absent (e.g. file-sourced playlists).
 *
 * TiviMate behaviour:
 *  - Sends GET requests
 *  - Must receive HTTP 200 even on errors — non-200 causes player to disable playlist
 *  - Content-Type must be audio/x-mpegurl
 */

const { createClient } = require("@supabase/supabase-js");

const M3U_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, User-Agent",
  "Content-Type":  "audio/x-mpegurl; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const emptyM3U = "#EXTM3U\n";

// ── M3U parser ────────────────────────────────────────────────────────────

function parseM3U(content) {
  const lines = content.split(/\r?\n/);
  const channels = [];
  let current = null;
  let extraLines = [];
  let counter = 0;
  const ATTR_REGEX = /([a-zA-Z0-9-]+)="([^"]*)"/g;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTM3U")) continue;

    if (line.startsWith("#EXTINF")) {
      const commaIdx = line.indexOf(",");
      const meta     = commaIdx >= 0 ? line.slice(0, commaIdx) : line;
      const name     = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : "Unnamed";
      const attributes = {};
      ATTR_REGEX.lastIndex = 0;
      let m;
      while ((m = ATTR_REGEX.exec(meta)) !== null) attributes[m[1]] = m[2];
      current = {
        id: `ch_${counter++}`,
        name,
        originalName: name,
        category: attributes["group-title"] || "Uncategorized",
        attributes,
        enabled: true,
        extraLines: [],
      };
      extraLines = [];
      continue;
    }

    if (line.startsWith("#")) {
      if (current) extraLines.push(line);
      continue;
    }

    if (current) {
      current.url = line;
      current.extraLines = extraLines;
      channels.push(current);
      current = null;
      extraLines = [];
    }
  }
  return channels;
}

// ── Diff apply ────────────────────────────────────────────────────────────

function applyDiff(sourceChannels, diff) {
  const deletedSet  = new Set(diff.deleted  || []);
  const disabledSet = new Set(diff.disabled || []);
  const renamed     = diff.renamed  || {};
  const recatted    = diff.recatted || {};
  const order       = diff.order    || {};
  const added       = diff.added    || [];

  // Apply mutations to source channels, filtering deleted ones
  let result = sourceChannels
    .filter(c => !deletedSet.has(c.url))
    .map(c => ({
      ...c,
      enabled:    !disabledSet.has(c.url),
      name:       renamed[c.url]  ?? c.name,
      category:   recatted[c.url] ?? c.category,
      attributes: {
        ...c.attributes,
        ...(recatted[c.url] ? { "group-title": recatted[c.url] } : {}),
      },
    }));

  // Apply per-category ordering
  if (Object.keys(order).length > 0) {
    const byUrl       = new Map(result.map(c => [c.url, c]));
    const orderedCats = new Set(Object.keys(order));
    const unordered   = result.filter(c => !orderedCats.has(c.category));
    const ordered     = [];
    for (const [, urls] of Object.entries(order)) {
      for (const url of urls) {
        const ch = byUrl.get(url);
        if (ch) ordered.push(ch);
      }
    }
    result = [...ordered, ...unordered];
  }

  // Append added channels
  const addedChannels = added.map((a, i) => ({
    id:           `added_${i}`,
    name:         a.name,
    originalName: a.name,
    url:          a.url,
    category:     a.category,
    attributes:   a.attributes || {},
    extraLines:   a.extraLines || [],
    enabled:      !disabledSet.has(a.url),
  }));

  return [...result, ...addedChannels];
}

// ── M3U exporter (enabled channels only) ─────────────────────────────────

function exportM3U(channels) {
  const out = ["#EXTM3U"];
  for (const ch of channels) {
    if (!ch.enabled) continue;
    const attrs    = { ...ch.attributes, "group-title": ch.category };
    const attrStr  = Object.entries(attrs)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");
    const duration = attrs["tvg-duration"] || "-1";
    const prefix   = attrStr ? `#EXTINF:${duration} ${attrStr},` : `#EXTINF:${duration},`;
    out.push(`${prefix}${ch.name}`);
    for (const extra of ch.extraLines || []) out.push(extra);
    out.push(ch.url);
  }
  return out.join("\n") + "\n";
}

// ── Fetch source M3U via proxy ────────────────────────────────────────────

async function fetchSourceM3U(url) {
  const userAgents = [
    "okhttp/4.9.0",
    "VLC/3.0.18 LibVLC/3.0.18",
    "Tivimate/4.7.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  ];

  for (const ua of userAgents) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      const res = await fetch(url, {
        headers: { "User-Agent": ua, "Accept": "*/*", "Connection": "keep-alive" },
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const text = await res.text();
      if (text.includes("#EXTM3U") || text.includes("#EXTINF")) return text;
    } catch { continue; }
  }
  return null;
}

// ── Handler ───────────────────────────────────────────────────────────────

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: M3U_HEADERS, body: "" };
  }

  // ── Extract slug ──────────────────────────────────────────────
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
    // ── Look up slug → edited playlist ────────────────────────
    const { data: shared, error: se } = await supabase
      .from("shared_playlists")
      .select("edited_playlist_id")
      .eq("slug", slug)
      .maybeSingle();

    if (se || !shared) {
      console.error("playlist.js: slug not found:", slug, se?.message);
      return { statusCode: 200, headers: M3U_HEADERS, body: emptyM3U };
    }

    // ── Fetch edited playlist + its source ────────────────────
    const { data: playlist, error: pe } = await supabase
      .from("edited_playlists")
      .select("content, edits_json, name, source_playlist_id")
      .eq("id", shared.edited_playlist_id)
      .maybeSingle();

    if (pe || !playlist) {
      console.error("playlist.js: playlist not found:", shared.edited_playlist_id, pe?.message);
      return { statusCode: 200, headers: M3U_HEADERS, body: emptyM3U };
    }

    const filename = (playlist.name || "playlist")
      .replace(/[^a-z0-9]/gi, "-").toLowerCase();

    // ── Try: fetch source live + apply diff ───────────────────
    if (playlist.edits_json && playlist.source_playlist_id) {
      const { data: sourceRow } = await supabase
        .from("source_playlists")
        .select("url")
        .eq("id", playlist.source_playlist_id)
        .maybeSingle();

      if (sourceRow?.url) {
        const sourceText = await fetchSourceM3U(sourceRow.url);
        if (sourceText) {
          try {
            const sourceChannels = parseM3U(sourceText);
            const diff           = JSON.parse(playlist.edits_json);
            const final          = applyDiff(sourceChannels, diff);
            const m3uContent     = exportM3U(final);
            const enabledCount   = final.filter(c => c.enabled).length;
            console.log(`playlist.js: serving ${enabledCount} channels (diff) for slug ${slug}`);
            return {
              statusCode: 200,
              headers: { ...M3U_HEADERS, "Content-Disposition": `inline; filename="${filename}.m3u"` },
              body: m3uContent,
            };
          } catch (diffErr) {
            console.error("playlist.js: diff apply failed:", diffErr.message);
            // fall through to content fallback
          }
        }
      }
    }

    // ── Fallback: serve stored content ────────────────────────
    if (playlist.content) {
      console.log(`playlist.js: serving stored content for slug ${slug}`);
      return {
        statusCode: 200,
        headers: { ...M3U_HEADERS, "Content-Disposition": `inline; filename="${filename}.m3u"` },
        body: playlist.content,
      };
    }

    console.error("playlist.js: no content available for slug:", slug);
    return { statusCode: 200, headers: M3U_HEADERS, body: emptyM3U };

  } catch (err) {
    console.error("playlist.js: unexpected error:", err);
    return { statusCode: 200, headers: M3U_HEADERS, body: emptyM3U };
  }
};
