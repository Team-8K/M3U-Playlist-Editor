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
  player_url?: string | null;
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

// ── Clean player URL via Netlify function + shared_playlists ────────────────
//
// URL format: https://<your-site>.netlify.app/api/playlist/<slug>.m3u
//
// - slug is 24 cryptographically-random hex characters (12 bytes)
// - stored once in shared_playlists table, never regenerated
// - Netlify function serves the current file content on every player poll
// - no Supabase domain, no token, no expiry

function generateSlug(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Return the permanent clean player URL for an edited playlist.
 * - Checks player_url on the row first — if present, returns it immediately.
 * - If not, creates a slug in shared_playlists, builds the Netlify URL,
 *   stores it on the row, and returns it.
 * - The URL never changes regardless of how many times the playlist is re-edited.
 */
export async function getOrCreatePlayerUrl(
  row: EditedPlaylistRow
): Promise<{ url: string; updatedRow: EditedPlaylistRow }> {
  // Already generated — return stored URL immediately
  if (row.player_url) {
    return { url: row.player_url, updatedRow: row };
  }

  if (!row.storage_path) {
    throw new Error("Save your playlist first, then get the player URL.");
  }

  const uid = await getUid();

  // Check if a shared_playlists row already exists for this playlist
  // (handles edge case where player_url wasn't saved to the row but the slug exists)
  const { data: existing } = await supabase
    .from("shared_playlists")
    .select("slug")
    .eq("edited_playlist_id", row.id)
    .maybeSingle();

  let slug: string;

  if (existing?.slug) {
    slug = existing.slug;
  } else {
    // Generate a new cryptographically-random slug and insert
    slug = generateSlug();
    const { error: ie } = await supabase
      .from("shared_playlists")
      .insert({ slug, edited_playlist_id: row.id, user_id: uid });
    if (ie) throw new Error(ie.message || "Could not create player URL");
  }

  // Build the clean Netlify URL
  const siteUrl = import.meta.env.VITE_SITE_URL || window.location.origin;
  const url = `${siteUrl}/api/playlist/${slug}.m3u`;

  // Persist on the playlist row so future calls return instantly
  const { data: updated, error: ue } = await supabase
    .from("edited_playlists")
    .update({ player_url: url })
    .eq("id", row.id)
    .select()
    .single();
  if (ue) throw ue;

  return { url, updatedRow: updated as EditedPlaylistRow };
}
