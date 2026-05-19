# Team 8K — Supabase Migration Guide

## What changed

| Before | After |
|---|---|
| Netlify Identity | **Supabase Auth** (only) |
| `@netlify/identity` widget | `@supabase/supabase-js` |
| Generic `playlists` table | `source_playlists` + `edited_playlists` |
| `email text` ownership | `auth.uid()` RLS on every row |
| No storage buckets | `source-playlists` + `edited-playlists` buckets |

---

## Step 1 — Create a Supabase project

1. Go to **https://supabase.com** → New project
2. Note your **Project URL** and **anon public key** (Settings → API)

---

## Step 2 — Run the migration SQL

1. Supabase Dashboard → **SQL Editor** → New query
2. Paste the entire contents of `supabase/migrations/001_initial_schema.sql`
3. Click **Run**

This creates:
- `profiles` — auto-populated on signup via trigger
- `source_playlists` — raw playlist sources per user
- `edited_playlists` — saved edited versions per user
- Storage buckets `source-playlists` and `edited-playlists`
- RLS policies so every row is locked to `auth.uid()`

---

## Step 3 — Configure Netlify environment variables

In **Netlify → Site → Environment variables**, add:

| Key | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://xxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` (anon/public key) |

**Do NOT add the service-role key.** The anon key is safe for the browser because RLS is enforced.

---

## Step 4 — Remove Netlify Identity (if enabled)

1. Netlify → Site → **Identity** → Disable Identity service
2. Remove any `netlify-identity-widget` script tags if you added them manually outside this repo (the repo's `index.html` doesn't have any — you're clear)

---

## Step 5 — Deploy

Push to your repo. Netlify rebuilds automatically. The app will:
- Show a Supabase-powered sign-in gate
- Support Login / Sign up / Forgot password from the same screen
- Lock all DB rows and storage files to the authenticated user's `uid`

---

## Invite-only (optional hardening)

If you want to keep the tool subscriber-only (no self-signup), disable public signups in:

**Supabase → Authentication → Settings → "Enable email confirmations"** and turn off **"Allow new users to sign up"**.

Then create users manually via **Authentication → Users → Invite user** or with a server-side admin script using the `service_role` key (never in the browser).

---

## File reference

```
src/
  lib/
    supabase.ts          ← Supabase client + typed helpers
  components/
    AuthGate.tsx         ← Supabase Auth gate (login/signup/reset)
  App.tsx                ← Wraps app in <AuthGate>
supabase/
  migrations/
    001_initial_schema.sql  ← Run this once in SQL Editor
netlify.toml             ← Build config, no Identity references
package.json             ← @supabase/supabase-js added, @netlify/identity removed
```
