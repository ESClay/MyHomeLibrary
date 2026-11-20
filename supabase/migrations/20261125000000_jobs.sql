-- Background jobs: a shared queue worked by /api/jobs/tick (see docs/plans/background-jobs.md).
--
-- jobs         one row per piece of long-running work (a series lookup, later a batch of photo scans).
-- job_changes  the undo log: for each book a job changed, the fields it changed, before and after.
--
-- Only the service role (the worker) creates and advances jobs. A signed-in person can read the jobs of a library
-- they belong to, cancel one (the library owner, or the person who started it) and mark one as seen. The column
-- grants and the guard trigger below keep that update to exactly those two things.

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries (id) on delete cascade,
  -- Who asked for it (the library owner for work the daily cron queues). The badge counts this person's jobs.
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('series_lookup', 'photo_scan')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  total integer not null default 0 check (total >= 0),
  processed integer not null default 0 check (processed >= 0),
  -- Where the worker resumes; its shape belongs to the kind.
  cursor jsonb,
  -- What the job did, for the Activity page; its shape belongs to the kind.
  summary jsonb not null default '{}',
  error text,
  -- Not picked up before this time (a rate limit sets it).
  not_before timestamptz,
  -- The lease: a worker holds the job until locked_until and renews it after each slice. A crashed worker's lease
  -- simply runs out and the next tick carries on from the cursor.
  locked_until timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  -- Set when the person has opened the result; the nav badge counts finished jobs where this is null.
  seen_at timestamptz
);

create index jobs_library_idx on public.jobs (library_id, created_at desc);
-- What the worker scans for, and what the badge counts.
create index jobs_active_idx on public.jobs (created_at) where status in ('queued', 'running');
create index jobs_unseen_idx on public.jobs (user_id) where seen_at is null and status in ('done', 'failed');

-- One series lookup at a time per library: asking again returns the one already queued or running.
create unique index jobs_one_active_series_lookup on public.jobs (library_id)
  where kind = 'series_lookup' and status in ('queued', 'running');

create table public.job_changes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  -- Only the fields the job changed (series_name, series_position, series_id, hardcover_id), as they were and as they became.
  before jsonb not null,
  after jsonb not null,
  undone_at timestamptz,
  -- One row per book per job: a book changed in several slices keeps its first `before` and its last `after`.
  unique (job_id, book_id)
);

create index job_changes_book_idx on public.job_changes (book_id);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.jobs enable row level security;
alter table public.job_changes enable row level security;

create policy "members read library jobs" on public.jobs
  for select to authenticated
  using (public.is_library_member(library_id, (select auth.uid())));

create policy "owner or requester updates a job" on public.jobs
  for update to authenticated
  using (
    public.is_library_member(library_id, (select auth.uid()))
    and (user_id = (select auth.uid()) or public.library_role(library_id, (select auth.uid())) = 'owner')
  )
  with check (
    public.is_library_member(library_id, (select auth.uid()))
    and (user_id = (select auth.uid()) or public.library_role(library_id, (select auth.uid())) = 'owner')
  );

create policy "members read library job changes" on public.job_changes
  for select to authenticated
  using (
    exists (
      select 1 from public.jobs j
      where j.id = job_id and public.is_library_member(j.library_id, (select auth.uid()))
    )
  );

-- No insert, delete or other update policy exists for anyone: the service role bypasses RLS and does the writing.
revoke all on public.jobs from anon, authenticated;
revoke all on public.job_changes from anon, authenticated;
grant select on public.jobs to authenticated;
grant select on public.job_changes to authenticated;
-- A signed-in person may change only these two columns...
grant update (status, seen_at) on public.jobs to authenticated;

-- ...and status only to cancel a job that has not finished.
create function public.jobs_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and new.status is distinct from old.status then
    if not (new.status = 'cancelled' and old.status in ('queued', 'running')) then
      raise exception 'A job can only be cancelled while it is queued or running' using errcode = '42501';
    end if;
    new.finished_at := coalesce(new.finished_at, now());
    new.locked_until := null;
    new.locked_by := null;
  end if;
  return new;
end;
$$;

create trigger jobs_guard_update
  before update on public.jobs
  for each row execute function public.jobs_guard_update();

-- ---------------------------------------------------------------------------
-- claim_job: hands one job to one worker. `for update skip locked` means two ticks claiming at the same moment never
-- get the same row; the lease (locked_until / locked_by) keeps others off it until it runs out; not_before holds a job
-- back after a rate limit. Only the kinds the caller can handle are considered. Returns no row when nothing is due.
-- ---------------------------------------------------------------------------
create function public.claim_job(p_run text, p_kinds text[], p_lease_seconds integer default 300)
returns setof public.jobs
language sql
set search_path = ''
as $$
  update public.jobs j
  set status = 'running',
      locked_by = p_run,
      locked_until = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(j.started_at, now())
  where j.id = (
    select c.id
    from public.jobs c
    where c.status in ('queued', 'running')
      and c.kind = any (p_kinds)
      and (c.not_before is null or c.not_before <= now())
      and (c.locked_until is null or c.locked_until < now())
    order by c.created_at
    limit 1
    for update skip locked
  )
  returning j.*;
$$;

revoke all on function public.claim_job(text, text[], integer) from public, anon, authenticated;
grant execute on function public.claim_job(text, text[], integer) to service_role;

comment on table public.jobs is 'Background work queue, worked by /api/jobs/tick. Written by the service role only.';
comment on table public.job_changes is 'Undo log: the fields a job changed on each book, before and after.';
