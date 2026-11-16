-- Phase 5 (Discover): series sync columns, recommendation scopes and the cron run log.

-- ---------------------------------------------------------------------------
-- Series cache. `series.synced_at` already exists (schema migration); entries gain a compilation flag.
-- Both tables stay service-role write only (see the Phase 1 RLS migration).
-- ---------------------------------------------------------------------------
alter table public.series add column author_name text;

-- True for omnibuses, box sets and other compilations, so they never count as a missing volume.
alter table public.series_entries add column is_compilation boolean not null default false;
alter table public.series_entries add column details text;

-- When the series sync last looked for this book's series (found or not), so a book that has none
-- is not looked up again on every run.
alter table public.books add column series_checked_at timestamptz;
create index books_series_unchecked_idx on public.books (library_id) where series_id is null and series_checked_at is null;

-- ---------------------------------------------------------------------------
-- Recommendation sets: personal (one person) or shared (one library, no single owner).
-- ---------------------------------------------------------------------------
alter table public.recommendation_sets alter column user_id drop not null;
alter table public.recommendation_sets alter column user_id drop default;

alter table public.recommendation_sets add column scope text not null default 'personal'
  check (scope in ('personal', 'shared'));
-- 'manual' = someone pressed Refresh (counts toward the daily cap), 'cron' = the weekly job.
alter table public.recommendation_sets add column trigger_source text not null default 'manual'
  check (trigger_source in ('manual', 'cron'));
-- 'failed' rows record a model call that cost tokens but produced nothing usable; they still count toward the cap.
alter table public.recommendation_sets add column status text not null default 'ok'
  check (status in ('ok', 'failed'));
alter table public.recommendation_sets add column error text;
alter table public.recommendation_sets add column model text;
alter table public.recommendation_sets add column input_tokens integer;
alter table public.recommendation_sets add column output_tokens integer;
-- Who pressed Refresh on a shared set (null for the cron job).
alter table public.recommendation_sets add column requested_by uuid references auth.users (id) on delete set null;

alter table public.recommendation_sets add constraint recommendation_sets_scope_user check (
  (scope = 'personal' and user_id is not null) or (scope = 'shared' and user_id is null)
);

create index recommendation_sets_scope_idx on public.recommendation_sets (library_id, scope, generated_at desc);
create index recommendation_sets_personal_idx on public.recommendation_sets (user_id, library_id, generated_at desc)
  where scope = 'personal';

-- Feedback keeps what the pick was, so a later prompt can say "not interested in <title>".
alter table public.recommendation_feedback add column title text;
alter table public.recommendation_feedback add column authors text[] not null default '{}';

-- ---------------------------------------------------------------------------
-- RLS for recommendation_sets (replaces the Phase 1 "owner does everything" policy)
--   read:   a personal set only by its owner; a shared set by every member of its library
--   insert: a personal set by its owner (for a library they belong to); a shared set by any member of
--           its library, naming themselves as requested_by. The cron job uses the service role.
--   update: nobody (sets are replaced, never edited)
--   delete: the owner of a personal set; any member for a shared set (pruning old sets)
-- ---------------------------------------------------------------------------
drop policy recommendation_sets_all on public.recommendation_sets;

create policy recommendation_sets_select on public.recommendation_sets for select to authenticated
  using (
    (scope = 'personal' and user_id = (select auth.uid()))
    or (scope = 'shared' and public.is_library_member(library_id, (select auth.uid())))
  );

create policy recommendation_sets_insert on public.recommendation_sets for insert to authenticated
  with check (
    public.is_library_member(library_id, (select auth.uid()))
    and (
      (scope = 'personal' and user_id = (select auth.uid()))
      or (scope = 'shared' and user_id is null and requested_by = (select auth.uid()))
    )
  );

create policy recommendation_sets_delete on public.recommendation_sets for delete to authenticated
  using (
    (scope = 'personal' and user_id = (select auth.uid()))
    or (scope = 'shared' and public.is_library_member(library_id, (select auth.uid())))
  );

-- recommendation_feedback keeps its Phase 1 policy: each person reads and writes only their own rows,
-- including feedback on shared picks.

-- ---------------------------------------------------------------------------
-- cron_runs: what the daily dispatcher last did per task. Service role only:
-- RLS is on and there is deliberately no policy, so signed-in users see and write nothing.
-- ---------------------------------------------------------------------------
create table public.cron_runs (
  task text primary key,
  last_run_at timestamptz,
  last_completed_at timestamptz,
  last_status text check (last_status in ('complete', 'partial', 'error', 'skipped')),
  last_detail jsonb not null default '{}',
  cursor jsonb,
  updated_at timestamptz not null default now()
);
alter table public.cron_runs enable row level security;
