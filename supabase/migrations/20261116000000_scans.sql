-- Phase 3b: photo recognition. A private `scans` bucket for the photo being read, plus the
-- bookkeeping columns scan_jobs needs (token usage, error, photo retention).
-- scan_status already has pending/processing/ready/saved/failed: "ready" is the finished state,
-- "saved" means the review was saved.

-- ---------------------------------------------------------------------------
-- scan_jobs: usage, error and retention columns
-- ---------------------------------------------------------------------------
alter table public.scan_jobs
  add column input_tokens integer check (input_tokens is null or input_tokens >= 0),
  add column output_tokens integer check (output_tokens is null or output_tokens >= 0),
  add column error text,
  add column photo_deleted_at timestamptz;

-- The photo must live under <library_id>/<user_id>/ so the storage policies line up with the row.
alter table public.scan_jobs
  add constraint scan_jobs_photo_path_check
  check (photo_path like library_id::text || '/' || user_id::text || '/%') not valid;

-- Daily cap lookups (per user, recent) and the cleanup sweep (photos not yet deleted, oldest first).
create index scan_jobs_cleanup_idx on public.scan_jobs (created_at) where photo_deleted_at is null;

-- (scan_jobs already has RLS enabled with scan_jobs_all: a user sees and changes only their own rows,
-- and may only create them in a library they can edit.)

-- ---------------------------------------------------------------------------
-- Storage: private `scans` bucket, <library_id>/<user_id>/<uuid>.jpg
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scans', 'scans', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- True when the object path is <library_id>/<uid>/<file>, the first segment is a library uid belongs to,
-- and the second segment is uid itself.
create function public.owns_scan_path(object_name text, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when uid is null then false
    when (storage.foldername(object_name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and (storage.foldername(object_name))[2] = uid::text
      then public.is_library_member(((storage.foldername(object_name))[1])::uuid, uid)
    else false
  end;
$$;
revoke all on function public.owns_scan_path(text, uuid) from public, anon;
grant execute on function public.owns_scan_path(text, uuid) to authenticated, service_role;

create policy scans_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'scans' and public.owns_scan_path(name, (select auth.uid())));
create policy scans_select on storage.objects for select to authenticated
  using (bucket_id = 'scans' and public.owns_scan_path(name, (select auth.uid())));
create policy scans_delete on storage.objects for delete to authenticated
  using (bucket_id = 'scans' and public.owns_scan_path(name, (select auth.uid())));
-- No update policy: a photo is written once and deleted.
