import { createClient } from "@supabase/supabase-js";

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnon) {
  throw new Error("Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
}

export const supabase = createClient(supabaseUrl, supabaseAnon);

// ── Types ─────────────────────────────────────────────────────────────────

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
  player_url?: string | null;
  channels_json?: any[] | null;
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

// ── Source playlist ───────────────────────────────────────────────────────

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

// ── Edited playlists ──────────────────────────────────────────────────────

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
  if (row.storage_path) {
    await supabase.storage.from("edited-playlists").remove([row.storage_path]);
  }
  const { error } = await supabase
    .from("edited_playlists")
    .delete()
    .eq("id", row.id);
  if (error) throw error;
}

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

export const saveSourcePlaylist    = upsertSourcePlaylist;
export const upsertEditedPlaylist  = saveNewEditedPlaylist;
export const saveEditedPlaylist    = saveNewEditedPlaylist;

// ── Player URL ────────────────────────────────────────────────────────────
//
// Permanent URL: https://yoursite.netlify.app/api/playlist/SLUG.m3u
// Generated once, stored in player_url column, never changes.
// The Netlify function reads channels_json on every player poll and
// generates fresh M3U text — edits appear automatically.

export async function getOrCreatePlayerUrl(
  row: EditedPlaylistRow
): Promise<{ url: string; updatedRow: EditedPlaylistRow }> {

  // Already have a stored URL — return immediately, no DB calls needed
  if (row.player_url) {
    return { url: row.player_url, updatedRow: row };
  }

  const uid = await getUid();

  // Check if a slug already exists for this playlist row
  const { data: existing, error: se } = await supabase
    .from("shared_playlists")
    .select("slug")
    .eq("edited_playlist_id", row.id)
    .maybeSingle();

  if (se) throw new Error(`Could not check for existing URL: ${se.message}`);

  let slug: string;

  if (existing?.slug) {
    slug = existing.slug;
  } else {
    // Cryptographically random 24-char hex slug (12 bytes)
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    slug = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");

    const { error: ie } = await supabase
      .from("shared_playlists")
      .insert({ slug, edited_playlist_id: row.id, user_id: uid });

    if (ie) throw new Error(`Could not create player URL: ${ie.message}`);
  }

  const url = `${window.location.origin}/api/playlist/${slug}.m3u`;

  const { data: updated, error: ue } = await supabase
    .from("edited_playlists")
    .update({ player_url: url })
    .eq("id", row.id)
    .select()
    .single();

  if (ue) throw new Error(`Could not save player URL: ${ue.message}`);

  return { url, updatedRow: updated as EditedPlaylistRow };
}
