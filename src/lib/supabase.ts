import { createClient } from "@supabase/supabase-js";

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

export type EditedPlaylistRow = {
  id: string;
  user_id: string;
  source_playlist_id?: string | null;
  name: string;
  content?: string | null;
  storage_path?: string | null;
  channel_count: number;
  enabled_count: number;
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

// ── Edited playlists — multiple per user ─────────────────────────────────

/** Save a brand-new named edited playlist (always creates a new row) */
export async function saveNewEditedPlaylist(
  data: Omit<EditedPlaylistRow, "id" | "user_id" | "created_at" | "updated_at">
): Promise<EditedPlaylistRow> {
  const uid = await getUid();
  const { data: row, error } = await supabase
    .from("edited_playlists")
    .insert({ ...data, user_id: uid })
    .select()
    .single();
  if (error) throw error;
  return row as EditedPlaylistRow;
}

/** Overwrite an existing edited playlist by id */
export async function updateEditedPlaylist(
  id: string,
  patch: Partial<Omit<EditedPlaylistRow, "id" | "user_id" | "created_at" | "updated_at">>
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

/** Fetch all edited playlists for the current user, newest first */
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

/** Delete one edited playlist (and its storage file if any) */
export async function deleteEditedPlaylist(row: EditedPlaylistRow): Promise<void> {
  if (row.storage_path) {
    await supabase.storage.from("edited-playlists").remove([row.storage_path]);
  }
  const { error } = await supabase
    .from("edited_playlists")
    .delete()
    .eq("id", row.id);
  if (error) throw error;
}

// ── Upload file to storage ────────────────────────────────────────────────
export async function uploadPlaylistFile(
  bucket: "source-playlists" | "edited-playlists",
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

// ── Legacy aliases (keep old callers working) ─────────────────────────────
export const saveSourcePlaylist = upsertSourcePlaylist;
/** @deprecated prefer saveNewEditedPlaylist or updateEditedPlaylist */
export const upsertEditedPlaylist = saveNewEditedPlaylist;
export const saveEditedPlaylist   = saveNewEditedPlaylist;

// ── Signed player URL (max expiry = 1 year) ───────────────────────────────

/**
 * @deprecated Use getOrCreateSharedPlaylistUrl() instead.
 * Signed URLs change every time they're generated, breaking player auto-refresh.
 */
export async function createPlaylistSignedUrl(storagePath: string): Promise<string> {
  const PERMANENT = 100 * 365 * 24 * 60 * 60;
  const { data, error } = await supabase.storage
    .from("edited-playlists")
    .createSignedUrl(storagePath, PERMANENT);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || "Could not generate player URL");
  }
  return data.signedUrl;
}

// ── Permanent player URL via shared_playlists slug ────────────────────────

/**
 * Returns a permanent, stable M3U URL for an edited playlist.
 * The URL never changes — it resolves via the /api/playlist/:slug.m3u
 * Netlify function which always reads the latest saved content from the DB.
 *
 * - First call: creates a row in shared_playlists with a random hex slug.
 * - Subsequent calls: returns the same slug → same URL forever.
 * - When the user re-edits and saves the playlist, the content in
 *   edited_playlists is updated in-place, so the URL auto-refreshes in
 *   any player that polls it (TiviMate, Kodi, VLC, etc.).
 */
export async function getOrCreateSharedPlaylistUrl(editedPlaylistId: string): Promise<string> {
  // 1. Check for an existing slug
  const { data: existing, error: fetchErr } = await supabase
    .from("shared_playlists")
    .select("slug")
    .eq("edited_playlist_id", editedPlaylistId)
    .maybeSingle();

  if (fetchErr) throw new Error(fetchErr.message);

  let slug: string;

  if (existing?.slug) {
    slug = existing.slug;
  } else {
    // 2. Create a new permanent slug (16 hex chars)
    const arr = new Uint8Array(8);
    crypto.getRandomValues(arr);
    slug = Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");

    const uid = await getUid();
    const { error: insertErr } = await supabase
      .from("shared_playlists")
      .insert({ edited_playlist_id: editedPlaylistId, slug, user_id: uid });

    if (insertErr) throw new Error(insertErr.message);
  }

  // 3. Build the permanent URL — works on any host (local dev + production)
  const base = typeof window !== "undefined"
    ? window.location.origin
    : "";
  return `${base}/api/playlist/${slug}.m3u`;
}
