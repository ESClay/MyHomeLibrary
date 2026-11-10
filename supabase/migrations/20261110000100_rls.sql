-- Row-Level Security: helpers, policies, and the invite-acceptance RPC.

-- ---------------------------------------------------------------------------
-- Helpers (security definer so policies never recurse into library_members RLS)
-- ---------------------------------------------------------------------------
create function public.library_role(lib uuid, uid uuid)
returns public.library_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.library_members where library_id = lib and user_id = uid;
$$;

create function public.is_library_member(lib uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.library_members where library_id = lib and user_id = uid
  );
$$;

-- True for owners and editors.
create function public.can_edit_library(lib uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.library_role(lib, uid) in ('owner', 'editor'), false);
$$;

create function public.book_library_id(book uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select library_id from public.books where id = book;
$$;

create function public.copy_library_id(copy uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.library_id from public.copies c join public.books b on b.id = c.book_id where c.id = copy;
$$;

create function public.shelf_library_id(shelf uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select library_id from public.shelves where id = shelf;
$$;

-- True when the two users belong to at least one common library.
create function public.shares_library(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.library_members m1
    join public.library_members m2 on m2.library_id = m1.library_id
    where m1.user_id = a and m2.user_id = b
  );
$$;

-- Only signed-in users (and the service role) may call these.
do $$
declare
  f text;
begin
  foreach f in array array[
    'library_role(uuid, uuid)', 'is_library_member(uuid, uuid)', 'can_edit_library(uuid, uuid)',
    'book_library_id(uuid)', 'copy_library_id(uuid)', 'shelf_library_id(uuid)',
    'shares_library(uuid, uuid)', 'handle_new_user()', 'add_owner_as_member()'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invite acceptance
-- ---------------------------------------------------------------------------
create function public.accept_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  inv public.library_invites;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into inv from public.library_invites where token = invite_token for update;

  if not found then
    raise exception 'Invite not found' using errcode = 'P0002';
  end if;
  if inv.accepted_at is not null then
    raise exception 'Invite already used' using errcode = 'P0001';
  end if;
  if inv.expires_at <= now() then
    raise exception 'Invite expired' using errcode = 'P0001';
  end if;

  insert into public.library_members (library_id, user_id, role)
  values (inv.library_id, uid, inv.role)
  on conflict (library_id, user_id) do nothing;

  update public.library_invites
  set accepted_at = now(), accepted_by = uid
  where id = inv.id;

  return inv.library_id;
end;
$$;

revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.libraries enable row level security;
alter table public.library_members enable row level security;
alter table public.library_invites enable row level security;
alter table public.series enable row level security;
alter table public.series_entries enable row level security;
alter table public.books enable row level security;
alter table public.copies enable row level security;
alter table public.price_history enable row level security;
alter table public.loans enable row level security;
alter table public.shelves enable row level security;
alter table public.shelf_books enable row level security;
alter table public.user_books enable row level security;
alter table public.recommendation_sets enable row level security;
alter table public.recommendation_feedback enable row level security;
alter table public.scan_jobs enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: yourself and people you share a library with; edit only your own
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_library((select auth.uid()), id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- libraries
-- owner_id is also allowed in select so INSERT ... RETURNING works before the
-- AFTER INSERT trigger's membership row is visible to the statement.
-- ---------------------------------------------------------------------------
create policy libraries_select on public.libraries for select to authenticated
  using (public.is_library_member(id, (select auth.uid())) or owner_id = (select auth.uid()));
create policy libraries_insert on public.libraries for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy libraries_update on public.libraries for update to authenticated
  using (public.library_role(id, (select auth.uid())) = 'owner')
  with check (public.library_role(id, (select auth.uid())) = 'owner');
create policy libraries_delete on public.libraries for delete to authenticated
  using (public.library_role(id, (select auth.uid())) = 'owner');

-- ---------------------------------------------------------------------------
-- library_members: members read; owner changes roles / removes (never the library's owner).
-- Rows are created only by the library trigger and accept_invite().
-- ---------------------------------------------------------------------------
create policy library_members_select on public.library_members for select to authenticated
  using (public.is_library_member(library_id, (select auth.uid())));
create policy library_members_update on public.library_members for update to authenticated
  using (
    public.library_role(library_id, (select auth.uid())) = 'owner'
    and user_id <> (select l.owner_id from public.libraries l where l.id = library_id)
  )
  with check (
    public.library_role(library_id, (select auth.uid())) = 'owner'
    and user_id <> (select l.owner_id from public.libraries l where l.id = library_id)
  );
create policy library_members_delete on public.library_members for delete to authenticated
  using (
    public.library_role(library_id, (select auth.uid())) = 'owner'
    and user_id <> (select l.owner_id from public.libraries l where l.id = library_id)
  );

-- ---------------------------------------------------------------------------
-- library_invites: owner only
-- ---------------------------------------------------------------------------
create policy library_invites_all on public.library_invites for all to authenticated
  using (public.library_role(library_id, (select auth.uid())) = 'owner')
  with check (public.library_role(library_id, (select auth.uid())) = 'owner');

-- ---------------------------------------------------------------------------
-- series / series_entries: shared cache, readable by signed-in users,
-- written only by the service role (which bypasses RLS)
-- ---------------------------------------------------------------------------
create policy series_select on public.series for select to authenticated using (true);
create policy series_entries_select on public.series_entries for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- books: members read, owner/editor write
-- ---------------------------------------------------------------------------
create policy books_select on public.books for select to authenticated
  using (public.is_library_member(library_id, (select auth.uid())));
create policy books_insert on public.books for insert to authenticated
  with check (public.can_edit_library(library_id, (select auth.uid())));
create policy books_update on public.books for update to authenticated
  using (public.can_edit_library(library_id, (select auth.uid())))
  with check (public.can_edit_library(library_id, (select auth.uid())));
create policy books_delete on public.books for delete to authenticated
  using (public.can_edit_library(library_id, (select auth.uid())));

-- ---------------------------------------------------------------------------
-- copies (library via book)
-- ---------------------------------------------------------------------------
create policy copies_select on public.copies for select to authenticated
  using (public.is_library_member(public.book_library_id(book_id), (select auth.uid())));
create policy copies_insert on public.copies for insert to authenticated
  with check (public.can_edit_library(public.book_library_id(book_id), (select auth.uid())));
create policy copies_update on public.copies for update to authenticated
  using (public.can_edit_library(public.book_library_id(book_id), (select auth.uid())))
  with check (public.can_edit_library(public.book_library_id(book_id), (select auth.uid())));
create policy copies_delete on public.copies for delete to authenticated
  using (public.can_edit_library(public.book_library_id(book_id), (select auth.uid())));

-- ---------------------------------------------------------------------------
-- price_history and loans (library via copy)
-- ---------------------------------------------------------------------------
create policy price_history_select on public.price_history for select to authenticated
  using (public.is_library_member(public.copy_library_id(copy_id), (select auth.uid())));
create policy price_history_insert on public.price_history for insert to authenticated
  with check (public.can_edit_library(public.copy_library_id(copy_id), (select auth.uid())));
create policy price_history_delete on public.price_history for delete to authenticated
  using (public.can_edit_library(public.copy_library_id(copy_id), (select auth.uid())));

create policy loans_select on public.loans for select to authenticated
  using (public.is_library_member(public.copy_library_id(copy_id), (select auth.uid())));
create policy loans_insert on public.loans for insert to authenticated
  with check (public.can_edit_library(public.copy_library_id(copy_id), (select auth.uid())));
create policy loans_update on public.loans for update to authenticated
  using (public.can_edit_library(public.copy_library_id(copy_id), (select auth.uid())))
  with check (public.can_edit_library(public.copy_library_id(copy_id), (select auth.uid())));
create policy loans_delete on public.loans for delete to authenticated
  using (public.can_edit_library(public.copy_library_id(copy_id), (select auth.uid())));

-- ---------------------------------------------------------------------------
-- shelves and shelf_books
-- ---------------------------------------------------------------------------
create policy shelves_select on public.shelves for select to authenticated
  using (public.is_library_member(library_id, (select auth.uid())));
create policy shelves_insert on public.shelves for insert to authenticated
  with check (public.can_edit_library(library_id, (select auth.uid())));
create policy shelves_update on public.shelves for update to authenticated
  using (public.can_edit_library(library_id, (select auth.uid())))
  with check (public.can_edit_library(library_id, (select auth.uid())));
create policy shelves_delete on public.shelves for delete to authenticated
  using (public.can_edit_library(library_id, (select auth.uid())));

create policy shelf_books_select on public.shelf_books for select to authenticated
  using (public.is_library_member(public.shelf_library_id(shelf_id), (select auth.uid())));
-- The shelf and the book must belong to the same library.
create policy shelf_books_insert on public.shelf_books for insert to authenticated
  with check (
    public.can_edit_library(public.shelf_library_id(shelf_id), (select auth.uid()))
    and public.book_library_id(book_id) = public.shelf_library_id(shelf_id)
  );
create policy shelf_books_update on public.shelf_books for update to authenticated
  using (public.can_edit_library(public.shelf_library_id(shelf_id), (select auth.uid())))
  with check (
    public.can_edit_library(public.shelf_library_id(shelf_id), (select auth.uid()))
    and public.book_library_id(book_id) = public.shelf_library_id(shelf_id)
  );
create policy shelf_books_delete on public.shelf_books for delete to authenticated
  using (public.can_edit_library(public.shelf_library_id(shelf_id), (select auth.uid())));

-- ---------------------------------------------------------------------------
-- user_books: every member of the book's library can read; only the owner of
-- the row can write (and only while still a member of that library).
-- ---------------------------------------------------------------------------
create policy user_books_select on public.user_books for select to authenticated
  using (public.is_library_member(public.book_library_id(book_id), (select auth.uid())));
create policy user_books_insert on public.user_books for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_library_member(public.book_library_id(book_id), (select auth.uid()))
  );
create policy user_books_update on public.user_books for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.is_library_member(public.book_library_id(book_id), (select auth.uid()))
  );
create policy user_books_delete on public.user_books for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- recommendation_* and scan_jobs: private to the user
-- ---------------------------------------------------------------------------
create policy recommendation_sets_all on public.recommendation_sets for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.is_library_member(library_id, (select auth.uid()))
  );

create policy recommendation_feedback_all on public.recommendation_feedback for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy scan_jobs_all on public.scan_jobs for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.can_edit_library(library_id, (select auth.uid()))
  );
