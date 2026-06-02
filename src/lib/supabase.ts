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
  content?: string | null;        // full M3U text (file-sourced playlists) or null
  edits_json?: string | null;     // JSON-serialised PlaylistDiff for url-sourced playlists
  storage_path?: string | null;   // legacy — no longer written, kept for old rows
  player_url?: string | null;     // cached stable player URL shown on dashboard
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

// ── Legacy aliases (keep old callers working) ─────────────────────────────
export const saveSourcePlaylist = upsertSourcePlaylist;
/** @deprecated prefer saveNewEditedPlaylist or updateEditedPlaylist */
export const upsertEditedPlaylist = saveNewEditedPlaylist;
export const saveEditedPlaylist   = saveNewEditedPlaylist;

// ── Player URL — slug-based, permanent ────────────────────────────────────

/**
 * Return the permanent player URL for an edited playlist.
 *
 * On first call: creates a row in shared_playlists with a random slug,
 * caches the resulting URL in edited_playlists.player_url, and returns it.
 *
 * On subsequent calls: returns the cached player_url immediately.
 *
 * The URL never changes across re-saves because it is tied to the slug,
 * which is tied to the edited_playlist id — both immutable once created.
 */
export async function getOrCreatePlayerUrl(
  row: EditedPlaylistRow
): Promise<{ url: string; updatedRow: EditedPlaylistRow }> {
  // Already cached — return immediately
  if (row.player_url) {
    return { url: row.player_url, updatedRow: row };
  }

  const uid = await getUid();

  // Check if a shared_playlists row already exists for this edited playlist
  const { data: existing } = await supabase
    .from("shared_playlists")
    .select("slug")
    .eq("edited_playlist_id", row.id)
    .maybeSingle();

  let slug: string;

  if (existing?.slug) {
    slug = existing.slug;
  } else {
    // Generate a random 24-char hex slug
    const arr = new Uint8Array(12);
    crypto.getRandomValues(arr);
    slug = Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");

    const { error: ie } = await supabase
      .from("shared_playlists")
      .insert({ slug, edited_playlist_id: row.id, user_id: uid });
    if (ie) throw new Error(ie.message);
  }

  // Stable URL — works on any deployment
  const base = window.location.origin;
  const url  = `${base}/api/playlist/${slug}.m3u`;

  // Cache on the row so we never regenerate
  const { data: updated, error: ue } = await supabase
    .from("edited_playlists")
    .update({ player_url: url })
    .eq("id", row.id)
    .select()
    .single();
  if (ue) throw ue;

  return { url, updatedRow: updated as EditedPlaylistRow };
}
