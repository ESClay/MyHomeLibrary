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

## Photo recognition (Add > Photograph covers)

- Needs `ANTHROPIC_API_KEY`. The model is set in one place (`IDENTIFY_MODEL` in `src/lib/ai/identify.ts`). Each person gets 50 photo reads per rolling 24 hours (`DAILY_SCAN_CAP` in `src/lib/scan/photo.ts`); token usage per job is stored on `scan_jobs`.
- Photos go to the private `scans` bucket (`<library_id>/<user_id>/<uuid>.jpg`) and are deleted through the Storage API once the review is saved or discarded, or when the person leaves the page (best effort).
- Safety net: the daily cron job (`/api/cron/daily`, see below) removes photos older than 24 hours that were never cleared. `GET /api/cron/scan-cleanup` (header `Authorization: Bearer $CRON_SECRET`) still runs that step on its own.
- `/api/scan/[id]` sets `maxDuration = 300`, which Vercel honours up to your plan's limit.

## Daily background job

`vercel.json` schedules `GET /api/cron/daily` at 04:30 UTC. Vercel sends `Authorization: Bearer $CRON_SECRET`; the route also needs `SUPABASE_SERVICE_ROLE_KEY`. It runs whatever is due: scan-photo cleanup (daily), series re-sync (weekly), eBay price refresh (weekly per copy) and recommendation refresh (weekly). A task whose keys are missing is skipped without failing the others.

## Market prices (eBay)

Prices come from the eBay Browse API and need a **production** keyset. Until `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` are set, price checks show as not configured and the daily job skips them.

1. Create a free developer account at <https://developer.ebay.com>.
2. Go to *Application Keys* (Hi, name > Application Keysets) and create a **Production** keyset. Sandbox returns fake listings.
3. When eBay asks about *Marketplace account deletion* notifications, choose the **exemption**: this app only reads public listings and stores no eBay user data.
4. Copy the **App ID (Client ID)** and **Cert ID (Client Secret)**.
5. Add them as `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` to `.env.local` and to Vercel (*Project Settings > Environment Variables*, all environments), then redeploy.
6. Check a price on a physical copy with an ISBN. Each library prices in its own region (Settings > Library), set from the owner's region.

## Project layout

- `src/app/(auth)/` sign-in, sign-up and `/invite/[token]`; `src/app/auth/callback` OAuth/email callback
- `src/app/(app)/` authenticated shell with Library, Shelves, Add, Discover and Settings
- `src/lib/supabase/` browser/server clients and the session-refresh proxy (`src/proxy.ts`)
- `supabase/migrations/` full data model and row-level security; `supabase/tests/` RLS tests
