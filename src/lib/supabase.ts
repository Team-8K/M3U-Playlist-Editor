import { createClient } from "@supabase/supabase-js";
import type { PlaylistDiff } from "./playlistDiff";

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnon) {
  throw new Error(
    "Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnon);

// ── Types ────────────────────────────────────────────────────────────────

export type SourcePlaylistRow = {
  id: string;
  user_id: string;
  name: string;
  source_type: "file" | "url" | "xtream";
  url?: string | null;
  xtream_host?: string | null;
  xtream_user?: string | null;
  storage_path?: string | null;
  channel_count: number;
  created_at: string;
  updated_at: string;
};

/**
 * Edited playlists are now metadata-only. The full M3U is NEVER stored.
 * Instead we keep `edits_json` (a small diff against the source) and
 * rebuild the M3U on demand — both in the editor and in the share
 * function that players hit.
 */
export type EditedPlaylistRow = {
  id: string;
  user_id: string;
  source_playlist_id?: string | null;
  name: string;
  edits_json: PlaylistDiff;
  channel_count: number;
  enabled_count: number;
  created_at: string;
  updated_at: string;
};

export type SharedPlaylistRow = {
  id: string;
  slug: string;
  edited_playlist_id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
};

// ── Auth helper ───────────────────────────────────────────────────────────

async function getUid(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const uid = data?.session?.user?.id;
  if (!uid) throw new Error("Not authenticated");
  return uid;
}

// ── Source playlist — upsert (one per user) ──────────────────────────────
export async function upsertSourcePlaylist(
  data: Omit<SourcePlaylistRow, "id" | "user_id" | "created_at" | "updated_at">
): Promise<SourcePlaylistRow> {
  const uid = await getUid();

  const { data: existing } = await supabase
    .from("source_playlists")
    .select("id")
    .eq("user_id", uid)
    .maybeSingle();

  if (existing?.id) {
    const { data: row, error } = await supabase
      .from("source_playlists")
      .update({ ...data })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw error;
    return row as SourcePlaylistRow;
  } else {
    const { data: row, error } = await supabase
      .from("source_playlists")
      .insert({ ...data, user_id: uid })
      .select()
      .single();
    if (error) throw error;
    return row as SourcePlaylistRow;
  }
}

// ── Edited playlists — metadata only ─────────────────────────────────────

export async function saveNewEditedPlaylist(data: {
  source_playlist_id: string | null;
  name: string;
  edits_json: PlaylistDiff;
  channel_count: number;
  enabled_count: number;
}): Promise<EditedPlaylistRow> {
  const uid = await getUid();
  const { data: row, error } = await supabase
    .from("edited_playlists")
    .insert({ ...data, user_id: uid })
    .select()
    .single();
  if (error) throw error;
  return row as EditedPlaylistRow;
}

export async function updateEditedPlaylist(
  id: string,
  patch: Partial<{
    name: string;
    edits_json: PlaylistDiff;
    channel_count: number;
    enabled_count: number;
    source_playlist_id: string | null;
  }>
): Promise<EditedPlaylistRow> {
  const { data: row, error } = await supabase
    .from("edited_playlists")
    .update({ ...patch })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return row as EditedPlaylistRow;
}

export async function listEditedPlaylists(): Promise<EditedPlaylistRow[]> {
  const uid = await getUid();
  const { data, error } = await supabase
    .from("edited_playlists")
    .select("*")
    .eq("user_id", uid)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as EditedPlaylistRow[];
}

export async function deleteEditedPlaylist(row: EditedPlaylistRow): Promise<void> {
  const { error } = await supabase
    .from("edited_playlists")
    .delete()
    .eq("id", row.id);
  if (error) throw error;
}

// ── Source-playlist upload helper (unchanged) ─────────────────────────────
// We still occasionally upload the RAW source M3U for `file`-type sources
// (a user-uploaded .m3u that has no URL we can re-fetch). The edited bucket
// is no longer used.
export async function uploadPlaylistFile(
  bucket: "source-playlists",
  filename: string,
  content: string
): Promise<string> {
  const uid = await getUid();
  const path = `${uid}/${filename}`;
  const blob = new Blob([content], { type: "audio/x-mpegurl" });

  const { error } = await supabase.storage.from(bucket).upload(path, blob, {
    upsert: true,
    contentType: "audio/x-mpegurl",
  });

  if (error) throw error;
  return path;
}

// ── Legacy aliases (keep old callers compiling) ──────────────────────────
export const saveSourcePlaylist = upsertSourcePlaylist;
export const upsertEditedPlaylist = saveNewEditedPlaylist;
export const saveEditedPlaylist   = saveNewEditedPlaylist;

// ── Stable share URL for players ─────────────────────────────────────────

/**
 * Returns a STABLE public URL (`/api/playlist/<slug>.m3u`) the user can
 * paste into TiviMate, Kodi, VLC, etc. The same slug is reused forever
 * for a given edited playlist, so re-editing auto-syncs to the player
 * without re-pasting the URL.
 *
 * The server function at that path rebuilds the M3U from source + diff
 * on every request — nothing is stored.
 */
export async function getOrCreatePlayerUrl(
  row: EditedPlaylistRow
): Promise<{ url: string; updatedRow: EditedPlaylistRow }> {
  const uid = await getUid();

  // Look up an existing slug for this edited playlist
  const { data: existing } = await supabase
    .from("shared_playlists")
    .select("slug")
    .eq("edited_playlist_id", row.id)
    .maybeSingle();

  let slug = existing?.slug as string | undefined;

  if (!slug) {
    slug = generateSlug();
    const { error } = await supabase
      .from("shared_playlists")
      .insert({ slug, edited_playlist_id: row.id, user_id: uid });
    if (error) throw error;
  }

  const url = `${window.location.origin}/api/playlist/${slug}.m3u`;
  return { url, updatedRow: row };
}

function generateSlug(): string {
  // 16 random hex chars — matches the regex in netlify/functions/playlist.js
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
