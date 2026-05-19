import { useCallback, useEffect, useState } from "react";
import {
  deletePlaylist,
  fetchPlaylists,
  savePlaylist,
  type SavedPlaylist,
} from "@/lib/supabase";

/**
 * Manages cloud playlist persistence via Supabase.
 * Falls back gracefully when Supabase is not configured or the user
 * is not authenticated.
 */
export function usePlaylistStorage(userEmail: string | null) {
  const [playlists, setPlaylists] = useState<SavedPlaylist[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAvailable = !!userEmail;

  // ── Load all playlists for this user ──────────────────────────────────────
  const load = useCallback(async () => {
    if (!isAvailable) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPlaylists(userEmail!);
      setPlaylists(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load playlists");
    } finally {
      setLoading(false);
    }
  }, [userEmail, isAvailable]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Save (create or overwrite) ─────────────────────────────────────────────
  const save = useCallback(
    async (name: string, content: string, existingId?: string) => {
      if (!isAvailable) throw new Error("Not signed in");
      setLoading(true);
      setError(null);
      try {
        const saved = await savePlaylist(userEmail!, name, content, existingId);
        setPlaylists((prev) => {
          const idx = prev.findIndex((p) => p.id === saved.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = saved;
            return next;
          }
          return [saved, ...prev];
        });
        return saved;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to save";
        setError(msg);
        throw new Error(msg);
      } finally {
        setLoading(false);
      }
    },
    [userEmail, isAvailable]
  );

  // ── Delete ────────────────────────────────────────────────────────────────
  const remove = useCallback(
    async (id: string) => {
      if (!isAvailable) throw new Error("Not signed in");
      setLoading(true);
      setError(null);
      try {
        await deletePlaylist(userEmail!, id);
        setPlaylists((prev) => prev.filter((p) => p.id !== id));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to delete";
        setError(msg);
        throw new Error(msg);
      } finally {
        setLoading(false);
      }
    },
    [userEmail, isAvailable]
  );

  return {
    playlists,
    loading,
    error,
    isAvailable,
    refresh: load,
    save,
    remove,
  };
}
