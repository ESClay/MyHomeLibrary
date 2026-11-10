# MyHomeLibrary

Virtual library for web and mobile: catalog your books, organize them on shelves, and share a library with family. Built as a mobile-first PWA with Next.js (App Router), Tailwind, shadcn/ui and Supabase.

Phase 1 (foundation) is implemented: auth, libraries, members and invites, the app shell and PWA manifest. Books, scanning, shelves and Discover arrive in later phases.

## Setup

Requires Node 20.19+ and npm.

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create a Supabase project** at <https://supabase.com/dashboard>. From *Project Settings > API* copy the project URL, the `anon` key and the `service_role` key.

3. **Run the migrations** (`supabase/migrations/`). Either:

   - with the CLI: `npx supabase login`, `npx supabase link --project-ref <ref>`, then `npx supabase db push`; or
   - paste `20261110000000_schema.sql` and then `20261110000100_rls.sql` into the dashboard SQL editor and run them in order.

4. **Configure auth** in the Supabase dashboard (*Authentication*):

   - *URL Configuration*: set Site URL to your deployed URL and add redirect URLs `http://localhost:3000/auth/callback` and `https://<your-domain>/auth/callback`.
   - *Providers > Email*: enabled by default. Turn off "Confirm email" for faster local testing if you like.
   - *Providers > Google*: create an OAuth client (Web application) in Google Cloud Console, set its authorized redirect URI to the callback URL shown in the Supabase Google provider page (`https://<ref>.supabase.co/auth/v1/callback`), then paste the client ID and secret into Supabase.
   - *Providers > Apple*: requires an Apple Developer account. Create a Services ID and a Sign in with Apple key, then enter them in the Supabase Apple provider page (see the Supabase docs for generating the client secret). The "Continue with Apple" button works once this is configured.

5. **Set environment variables**

   ```bash
   cp .env.example .env.local
   ```

   Fill in at least `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The other keys are for later phases. Never commit `.env.local`.

6. **Run the app**

   ```bash
   npm run dev
   ```

   Open <http://localhost:3000>, create an account, and create your first library. Camera features (phase 3) need HTTPS: use `next dev --experimental-https` or a Vercel preview.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server |
| `npm run lint` / `npm run typecheck` | ESLint, TypeScript |
| `npm test` | Vitest unit tests |
| `npm run test:e2e` | Playwright (iPhone, Pixel and desktop projects); run `npx playwright install` first |
| `npm run db:test` | pgTAP RLS tests in `supabase/tests/` (needs `npx supabase start`, which needs Docker) |

## Deploy to Vercel

1. Push the repo to GitHub and import it at <https://vercel.com/new> (framework preset: Next.js).
2. Add the environment variables from `.env.example` under *Project Settings > Environment Variables*.
3. Deploy, then add the production URL and `https://<domain>/auth/callback` to the Supabase redirect URLs (step 4 above).

## Project layout

- `src/app/(auth)/` sign-in, sign-up and `/invite/[token]`; `src/app/auth/callback` OAuth/email callback
- `src/app/(app)/` authenticated shell with Library, Shelves, Add, Discover and Settings
- `src/lib/supabase/` browser/server clients and the session-refresh proxy (`src/proxy.ts`)
- `supabase/migrations/` full data model and row-level security; `supabase/tests/` RLS tests
