/**
 * Team 8K — Shared Playlist Serve Function (metadata-only edition)
 *
 * Edited playlists are stored as a tiny diff against their source.
 * This function rebuilds the M3U on every request:
 *   slug → shared_playlists → edited_playlists.edits_json
 *                          → source_playlists (URL / Xtream / file)
 *                          → fetch source → parse → apply diff → output
 *
 * URL pattern: /api/playlist/SLUG.m3u
 * TiviMate requires HTTP 200 even on errors (otherwise the playlist is
 * permanently disabled in the player), so all error paths return an
 * empty M3U with status 200.
 */

const { createClient } = require("@supabase/supabase-js");

// ── Tiny inline copy of src/lib/m3u.ts (parse/export) ───────────────────
const ATTR_REGEX = /([a-zA-Z0-9-]+)="([^"]*)"/g;

function parseM3U(content) {
  const lines = content.split(/\r?\n/);
  const channels = [];
  let current = null;
  let extraLines = [];
  let counter = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTM3U")) continue;
    if (line.startsWith("#EXTINF")) {
      const commaIdx = line.indexOf(",");
      const meta = commaIdx >= 0 ? line.slice(0, commaIdx) : line;
      const name = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : "Unnamed";
      const attributes = {};
      ATTR_REGEX.lastIndex = 0;
      let m;
      while ((m = ATTR_REGEX.exec(meta)) !== null) attributes[m[1]] = m[2];
      current = {
        id: `ch_${counter++}`,
        name,
        category: attributes["group-title"] || "Uncategorized",
        attributes,
        enabled: true,
        extraLines: [],
      };
      extraLines = [];
      continue;
    }
    if (line.startsWith("#")) { if (current) extraLines.push(line); continue; }
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

function exportM3U(channels) {
  const out = ["#EXTM3U"];
  for (const ch of channels) {
    if (!ch.enabled) continue;
    const attrs = { ...ch.attributes, "group-title": ch.category };
    const attrStr = Object.entries(attrs)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}="${v}"`).join(" ");
    const duration = attrs["tvg-duration"] || "-1";
    const prefix = attrStr ? `#EXTINF:${duration} ${attrStr},` : `#EXTINF:${duration},`;
    out.push(`${prefix}${ch.name}`);
    for (const extra of ch.extraLines || []) out.push(extra);
    out.push(ch.url);
  }
  return out.join("\n") + "\n";
}

// ── Diff application (mirror of src/lib/playlistDiff.ts) ────────────────
const normUrl = (u) => (u || "").trim().toLowerCase();

function applyDiff(source, diff) {
  if (!diff || diff.v !== 1) return source;
  const removed = new Set(diff.removed || []);
  const overrides = diff.overrides || {};
  const fromSource = [];
  for (const ch of source) {
    const key = normUrl(ch.url);
    if (removed.has(key)) continue;
    const ov = overrides[key];
    if (ov) {
      fromSource.push({
        ...ch,
        name: ov.name ?? ch.name,
        category: ov.category ?? ch.category,
        enabled: ov.enabled ?? ch.enabled,
        attributes: { ...ch.attributes, "group-title": ov.category ?? ch.category },
      });
    } else fromSource.push(ch);
  }
  const combined = [...fromSource, ...(diff.added || [])];
  if (!diff.order || !diff.order.length) return combined;
  const byUrl = new Map(combined.map((c) => [normUrl(c.url), c]));
  const ordered = [];
  const used = new Set();
  for (const url of diff.order) {
    const c = byUrl.get(url);
    if (c && !used.has(url)) { ordered.push(c); used.add(url); }
  }
  for (const c of combined) if (!used.has(normUrl(c.url))) ordered.push(c);
  return ordered;
}

// ── Fetch the source M3U based on the source_playlists row ──────────────
async function fetchSourceM3U(supabase, sourceRow) {
  // 1. URL-mode source — refetch directly
  if (sourceRow.source_type === "url" && sourceRow.url) {
    const res = await fetch(sourceRow.url, {
      headers: { "User-Agent": "okhttp/4.9.0" },
    });
    if (!res.ok) throw new Error(`source URL ${res.status}`);
    return await res.text();
  }
  // 2. File-mode source — pull from the source-playlists bucket
  if (sourceRow.storage_path) {
    const { data, error } = await supabase.storage
      .from("source-playlists").download(sourceRow.storage_path);
    if (error || !data) throw new Error(`storage download failed: ${error?.message}`);
    return await data.text();
  }
  // 3. Xtream — we never store the password, so we can't rebuild server-side.
  throw new Error("Xtream sources cannot be rebuilt without the saved password");
}

exports.handler = async function (event) {
  const M3U_HEADERS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, User-Agent",
    "Content-Type":  "audio/x-mpegurl; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  };
  const emptyM3U = "#EXTM3U\n";
  const fail = (msg) => {
    console.error("playlist.js:", msg);
    return { statusCode: 200, headers: M3U_HEADERS, body: emptyM3U };
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: M3U_HEADERS, body: "" };
  }

  const raw = event.path || "";
  const match = raw.match(/\/([a-fA-F0-9]{12,})(?:\.m3u)?(?:\/.*)?$/);
  if (!match) return fail(`could not extract slug from path: ${raw}`);
  const slug = match[1];

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  // Use service role if available so RLS doesn't block reading another user's
  // source row when a player hits the public slug. Fall back to anon for
  // backward compat (works only if you've added a permissive policy).
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return fail("missing Supabase env vars");

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { data: shared, error: se } = await supabase
      .from("shared_playlists")
      .select("edited_playlist_id")
      .eq("slug", slug)
      .maybeSingle();
    if (se || !shared) return fail(`slug not found: ${slug}`);

    const { data: edited, error: pe } = await supabase
      .from("edited_playlists")
      .select("id, name, source_playlist_id, edits_json")
      .eq("id", shared.edited_playlist_id)
      .maybeSingle();
    if (pe || !edited) return fail("edited playlist not found");

    if (!edited.source_playlist_id) {
      return fail("edited playlist has no source — cannot rebuild");
    }

    const { data: src, error: sre } = await supabase
      .from("source_playlists")
      .select("*")
      .eq("id", edited.source_playlist_id)
      .maybeSingle();
    if (sre || !src) return fail("source playlist not found");

    const sourceText = await fetchSourceM3U(supabase, src);
    const sourceChannels = parseM3U(sourceText);
    if (!sourceChannels.length) return fail("source parsed to 0 channels");

    const rebuilt = applyDiff(sourceChannels, edited.edits_json || {});
    const m3u = exportM3U(rebuilt);

    const filename = (edited.name || "playlist")
      .replace(/[^a-z0-9]/gi, "-").toLowerCase();

    return {
      statusCode: 200,
      headers: {
        ...M3U_HEADERS,
        "Content-Disposition": `inline; filename="${filename}.m3u"`,
      },
      body: m3u,
    };
  } catch (err) {
    return fail(`unexpected: ${err && err.message ? err.message : err}`);
  }
};
