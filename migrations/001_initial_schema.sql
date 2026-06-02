-- ============================================================
-- Team 8K — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 1. PROFILES ─────────────────────────────────────────────
-- Auto-created when a user signs up via Supabase Auth
CREATE TABLE IF NOT EXISTS public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text,
  display_name text,
  created_at  timestamptz DEFAULT now() NOT NULL,
  updated_at  timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can only read/update their own profile
CREATE POLICY "profiles: select own"  ON public.profiles FOR SELECT  USING (auth.uid() = id);
CREATE POLICY "profiles: insert own"  ON public.profiles FOR INSERT  WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles: update own"  ON public.profiles FOR UPDATE  USING (auth.uid() = id);

-- Auto-create profile row on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (new.id, new.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ── 2. SOURCE PLAYLISTS ──────────────────────────────────────
-- The raw playlists a user loads (Xtream credentials / M3U URL / file name)
CREATE TABLE IF NOT EXISTS public.source_playlists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('file', 'url', 'xtream')),
  -- For URL mode
  url         text,
  -- For Xtream mode (store host + username; NEVER store plain password)
  xtream_host text,
  xtream_user text,
  -- Optional: path in storage bucket if we saved the raw M3U file
  storage_path text,
  channel_count int DEFAULT 0,
  created_at  timestamptz DEFAULT now() NOT NULL,
  updated_at  timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.source_playlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "source_playlists: own rows" ON public.source_playlists
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- ── 3. EDITED PLAYLISTS ──────────────────────────────────────
-- The edited / cleaned version after the user modifies channels
CREATE TABLE IF NOT EXISTS public.edited_playlists (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_playlist_id uuid REFERENCES public.source_playlists(id) ON DELETE SET NULL,
  name             text NOT NULL,
  -- Full serialised M3U text OR a storage path
  content          text,
  storage_path     text,
  channel_count    int DEFAULT 0,
  enabled_count    int DEFAULT 0,
  created_at       timestamptz DEFAULT now() NOT NULL,
  updated_at       timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.edited_playlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "edited_playlists: own rows" ON public.edited_playlists
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- ── 4. STORAGE BUCKETS ───────────────────────────────────────
-- Run via Supabase Dashboard → Storage, OR uncomment these if using
-- the Supabase CLI / service-role key:

INSERT INTO storage.buckets (id, name, public)
VALUES ('source-playlists', 'source-playlists', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('edited-playlists', 'edited-playlists', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for source-playlists bucket
-- Users can only access objects whose path starts with their own uid
CREATE POLICY "source-playlists: user folder" ON storage.objects
  FOR ALL
  USING  (bucket_id = 'source-playlists' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'source-playlists' AND (storage.foldername(name))[1] = auth.uid()::text);

-- RLS policies for edited-playlists bucket
CREATE POLICY "edited-playlists: user folder" ON storage.objects
  FOR ALL
  USING  (bucket_id = 'edited-playlists' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'edited-playlists' AND (storage.foldername(name))[1] = auth.uid()::text);


-- ── 5. UPDATED_AT TRIGGER ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_source_updated_at
  BEFORE UPDATE ON public.source_playlists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_edited_updated_at
  BEFORE UPDATE ON public.edited_playlists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
