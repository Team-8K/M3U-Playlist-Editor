-- ============================================================
-- Migration 003 — Shared playlist URLs for TiviMate / players
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.shared_playlists (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               text UNIQUE NOT NULL,          -- random hex, used in the URL
  edited_playlist_id uuid REFERENCES public.edited_playlists(id) ON DELETE CASCADE,
  user_id            uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

-- Index for fast slug lookups (the Netlify function hits this on every player refresh)
CREATE INDEX IF NOT EXISTS idx_shared_playlists_slug ON public.shared_playlists (slug);

-- Allow anyone (including unauthenticated players like TiviMate) to read shared playlists
ALTER TABLE public.shared_playlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read shared playlists"
  ON public.shared_playlists FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can manage their own shared playlists"
  ON public.shared_playlists FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
