# Plan: background job queue (series lookup and photo scans)

**Goal:** long-running work keeps going after you leave the page, and the app tells you when it's done so you can review it.

Decisions made with the user (2026-11-20):
- **Series lookup** applies what it finds straight away. The review page lists every change, with Undo per book and Undo all.
- **Notification** is in the app: a badge on the nav and a notice on the next page you open. No phone push this round.
- **Scope:** the shared queue, plus "Find my series" and photo scans moved onto it. The Calibre import stays as it is for now.

Per CLAUDE.md, Sonnet writes the code, and the UI work goes through `design-taste-frontend`. For app pages the gate is `shoot.mjs` screenshots plus a hand check (see `docs/design-gate.md`).

---

## 1. How it runs

- **Ticks.** Every minute, Supabase **pg_cron** calls the app with **pg_net**: `POST https://<production host>/api/jobs/tick` with `Authorization: Bearer <CRON_SECRET>`. The secret is read from **Supabase Vault**, never written into a migration.
- **The tick route** (`src/app/api/jobs/tick/route.ts`, `maxDuration = 300`):
  - It claims queued or stalled jobs with a lease: `update … set locked_until = now() + interval '5 min', locked_by = <run id> where id = (select … for update skip locked limit 1)`.
  - It works on them in slices for about 240 seconds. After each slice it saves progress and a cursor, and renews the lease.
  - It stops early on a rate limit (429) and sets `not_before` so the job waits for a later tick.
  - A crashed run just lets its lease expire. The next tick picks the job up from its cursor.
- **Starting a job.** When a job is queued, the server action also starts one tick at once with `after()` from `next/server` (check the Next 16 docs), so work begins without waiting for the minute.
- **Fallback.** The existing daily Vercel cron (`/api/cron/daily`) also calls the tick logic. If pg_cron is ever off, jobs still move forward once a day.
- **Local dev.** pg_cron can't reach `localhost`. Add a dev-only "Run jobs now" button, or `curl` the tick route with the secret.

## 2. Data

Migration `supabase/migrations/20261125000000_jobs.sql`:

**`public.jobs`**
- Columns: `id`, `library_id`, `user_id`, `kind`, `status`, `total`, `processed`, `cursor jsonb`, `summary jsonb`, `error`, `not_before`, `locked_until`, `locked_by`, `created_at`, `started_at`, `finished_at`, `seen_at`.
  - `kind` is `'series_lookup' | 'photo_scan'`.
  - `status` is `queued | running | done | failed | cancelled`.
- RLS: a member can read jobs in their library. Only the service role (the worker) writes, except that the owner may cancel a job and set `seen_at`.
- Only one active `series_lookup` per library, enforced by a partial unique index.

**`public.job_changes`** (the undo log)
- Columns: `id`, `job_id`, `book_id`, `before jsonb`, `after jsonb`, `undone_at`.
- It records exactly the fields the job changed (series_name, series_position, series_id, hardcover_id).
- Undo restores `before`, but only for fields that still equal `after`. A field you have edited since is left alone, and the review page shows that book as "edited since".

**The pg_cron schedule**
- It is written as a migration that reads the Vault secret and the app URL. The URL is a Vault entry too, so the migration has no hard-coded host.
- A short note says how to set the two Vault entries from the Supabase dashboard. The user does this once.

**Photo scans** keep using `scan_jobs` for each photo's result and its photo cleanup. A `photo_scan` job groups a batch, and `scan_jobs.job_id` links each photo to its batch.

## 3. Series lookup on the queue

- `refreshSeries` (`src/app/(app)/discover/actions.ts`) now queues a `series_lookup` job, or returns the active one, and returns at once.
- The worker runs the existing steps of `syncLibrarySeries` in slices: discover books, look up books with no series (the new step), refresh series, fill series fields.
  - Drop the 30-books-per-run cap. The pacer and the job's time slice now set the pace.
  - Each book it changes writes a `job_changes` row.
- **Discover** shows "Looking up series: 47 of 156 checked" with a Cancel button while the job runs. It updates when you come back to the page, or every 10 seconds while you stay on it. No websockets.
- **The daily cron** queues a `series_lookup` when books are due, rather than running it inline.

## 4. Photo scans on the queue

- **Upload stays on the page.** The photos are on the phone, so they have to upload while the page is open. Allow several photos at once, upload them one after another with progress, and queue one `photo_scan` job for the batch.
- **After upload you can leave.** The worker reads each photo with the existing identify-and-resolve code (moved out of `src/app/api/scan/[id]/route.ts` into a function both can call). It stores each result on its `scan_jobs` row.
- **The daily photo-read cap** (`dailyScanStatus`) is checked when photos are queued, and again per photo in the worker. Photos over the cap wait with "Waiting for tomorrow's allowance".
- **Leaving no longer discards.** The `pagehide` → discard beacon in `photo-screen.tsx` only applies to photos that haven't finished uploading. Queued photos are kept.
- **Review** happens on the existing review tray, opened from the "Ready to review" page or from the notice. Photos are still deleted from Storage after saving or discarding, and the existing `scan-cleanup` cron still sweeps old ones.

## 5. Telling you, and reviewing

- **Nav badge.** The app layout loads a count of your jobs that are `done` or `failed` with `seen_at` null. This is a cheap query; check it doesn't slow navigation down. A small badge shows on a new **"Activity"** nav item, on both the desktop sidebar and the mobile bar.
- **Notice.** The first page you open after a job finishes shows a short notice that you can dismiss, for example "Series lookup finished: 87 books got a series. Review". Opening the review sets `seen_at`.
- **Activity page** (`src/app/(app)/activity/page.tsx`):
  - Jobs that are running show their progress and a Cancel button.
  - Finished jobs show a summary and a link to their review.
  - A **series review** lists each book with its old and new series and number, with Undo per book, Undo all, and a filter for "edited since".
  - A **photo batch review** opens the scan review tray for that batch.

## 6. Tests

- **Unit:** claiming and leases (two workers never get the same job), the slice loop with a fake clock, 429 handling, the undo rule (fields changed since are kept), and the series job writing `job_changes`.
- **pgTAP:** jobs RLS (member read, non-member none, owner cancel only), the one-active-series-job index.
- **e2e (read-only for the viewer account):** the Activity page renders. The badge shows when an unseen finished job exists. That needs an editor account or a seeded job, so it skips otherwise.

## 7. What the user does once

1. Turn on the **pg_cron** and **pg_net** extensions in the Supabase dashboard if they aren't on already. The migration does `create extension if not exists`, which may need dashboard permission.
2. Add two **Vault** secrets: the app's production URL and `CRON_SECRET` (the same value as on Vercel).
3. Deploy, then apply the migration.

## Order

1. jobs table and RLS
2. worker and tick route
3. series lookup job and undo
4. Activity page, badge and notice
5. photo batch upload and photo job
6. pg_cron migration

Then do the final review against this plan and the design gate.
