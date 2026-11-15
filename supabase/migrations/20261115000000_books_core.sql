-- Phase 2 (books core): re-reads, cover storage, search and duplicate-check indexes.
-- Apply with `supabase db push`. Does not edit earlier migrations.

-- ---------------------------------------------------------------------------
-- reads: one row per read-through of a book, per person
-- ---------------------------------------------------------------------------
create table public.reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  started_at date,
  finished_at date,
  created_at timestamptz not null default now(),
  check (started_at is null or finished_at is null or finished_at >= started_at)
);
create index reads_book_id_idx on public.reads (book_id);
create index reads_user_book_idx on public.reads (user_id, book_id);

alter table public.reads enable row level security;

-- Same rules as user_books: every member of the book's library reads; only the
-- row's own user writes, and only while still a member of that library.
create policy reads_select on public.reads for select to authenticated
  using (public.is_library_member(public.book_library_id(book_id), (select auth.uid())));
create policy reads_insert on public.reads for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_library_member(public.book_library_id(book_id), (select auth.uid()))
  );
create policy reads_update on public.reads for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.is_library_member(public.book_library_id(book_id), (select auth.uid()))
  );
create policy reads_delete on public.reads for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- user_books.started_at / finished_at move to reads. Clean to drop: nothing
-- references them (no views, triggers, indexes or policies). Any dates already
-- stored are carried over as a read first, so no data is lost.
-- ---------------------------------------------------------------------------
insert into public.reads (user_id, book_id, started_at, finished_at)
select user_id, book_id, started_at, finished_at
from public.user_books
where started_at is not null or finished_at is not null;

alter table public.user_books drop column started_at;
alter table public.user_books drop column finished_at;

-- The half-star rating check (0.5 to 5 in 0.5 steps) already exists on
-- user_books.rating from the first migration, so it is not added again.

-- ---------------------------------------------------------------------------
-- books: free-text series name (the shared series cache is service-role only)
-- ---------------------------------------------------------------------------
alter table public.books add column series_name text;

-- ---------------------------------------------------------------------------
-- Search and duplicate-check indexes
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm with schema extensions;

create function public.books_search_text(title text, subtitle text, authors text[], series_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(
    coalesce(title, '') || ' ' || coalesce(subtitle, '') || ' ' ||
    coalesce(array_to_string(authors, ' '), '') || ' ' || coalesce(series_name, '')
  );
$$;

alter table public.books
  add column search_text text generated always as
    (public.books_search_text(title, subtitle, authors, series_name)) stored;

create index books_search_text_trgm_idx on public.books using gin (search_text extensions.gin_trgm_ops);
create index copies_edition_isbn_idx on public.copies (edition_isbn) where edition_isbn is not null;

-- ---------------------------------------------------------------------------
-- Storage: public `covers` bucket; writes only to <library_id>/... by editors
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- True when the object path starts with a library id the user may edit.
create function public.can_edit_cover_path(object_name text, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (storage.foldername(object_name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.can_edit_library(((storage.foldername(object_name))[1])::uuid, uid)
    else false
  end;
$$;
revoke all on function public.can_edit_cover_path(text, uuid) from public, anon;
grant execute on function public.can_edit_cover_path(text, uuid) to authenticated, service_role;

create policy covers_select on storage.objects for select to anon, authenticated
  using (bucket_id = 'covers');
create policy covers_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and public.can_edit_cover_path(name, (select auth.uid())));
create policy covers_update on storage.objects for update to authenticated
  using (bucket_id = 'covers' and public.can_edit_cover_path(name, (select auth.uid())))
  with check (bucket_id = 'covers' and public.can_edit_cover_path(name, (select auth.uid())));
create policy covers_delete on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and public.can_edit_cover_path(name, (select auth.uid())));
