-- Phase 3c: Calibre catalog import. Apply with `supabase db push`. Does not edit earlier migrations.

-- ---------------------------------------------------------------------------
-- books.calibre_uuid: the Calibre `uuid` of a book that came from an import, unique per library,
-- so importing the same catalog again skips the books it already brought in.
-- ---------------------------------------------------------------------------
alter table public.books add column calibre_uuid text;
create unique index books_library_calibre_uuid_idx
  on public.books (library_id, calibre_uuid)
  where calibre_uuid is not null;

-- ---------------------------------------------------------------------------
-- import_jobs: one row per import. `rows` holds the reviewed rows still to be saved (skipped rows are
-- never stored), `mapping` the read-status choices, `summary` the running counts and per-row errors.
-- ---------------------------------------------------------------------------
create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null default 'calibre' check (source in ('calibre')),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed', 'cancelled')),
  total integer not null default 0 check (total >= 0),
  processed integer not null default 0 check (processed >= 0 and processed <= total),
  rows jsonb not null default '[]' check (jsonb_typeof(rows) = 'array'),
  mapping jsonb not null default '{}',
  summary jsonb not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index import_jobs_user_idx on public.import_jobs (user_id, created_at desc);
create index import_jobs_library_idx on public.import_jobs (library_id);

create trigger set_updated_at before update on public.import_jobs
  for each row execute function public.set_updated_at();

alter table public.import_jobs enable row level security;

-- Private to the user who made it; a job can only be created in a library the user can edit.
create policy import_jobs_all on public.import_jobs for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.can_edit_library(library_id, (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Row transport. Both run as the caller, so import_jobs RLS applies.
-- ---------------------------------------------------------------------------
-- Appends one chunk of rows to a pending job and keeps `total` in step. Returns the new total.
create function public.import_append_rows(p_job uuid, p_rows jsonb)
returns integer
language sql
security invoker
set search_path = ''
as $$
  update public.import_jobs
     set rows = rows || p_rows,
         total = jsonb_array_length(rows || p_rows)
   where id = p_job and status = 'pending' and jsonb_typeof(p_rows) = 'array'
  returning total;
$$;

-- Returns rows [p_from, p_from + p_count) of a job, in order (used to resume after a reload).
create function public.import_rows_slice(p_job uuid, p_from integer, p_count integer)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(j.rows -> i order by i), '[]'::jsonb)
    from public.import_jobs j, generate_series(greatest(p_from, 0), least(p_from + p_count, j.total) - 1) as i
   where j.id = p_job;
$$;

revoke all on function public.import_append_rows(uuid, jsonb) from public, anon;
revoke all on function public.import_rows_slice(uuid, integer, integer) from public, anon;
grant execute on function public.import_append_rows(uuid, jsonb) to authenticated;
grant execute on function public.import_rows_slice(uuid, integer, integer) to authenticated;
