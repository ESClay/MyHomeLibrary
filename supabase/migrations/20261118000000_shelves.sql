-- Phase 4: shelves. Apply with `supabase db push`. Does not edit earlier migrations.
--
-- Shelves are shared with the library by default. Any member can also make private shelves that only
-- they see. A shelf is `manual` (rows in shelf_books) or `smart` (rules evaluated at read time, no rows).

create type public.shelf_visibility as enum ('shared', 'private');
create type public.shelf_kind as enum ('manual', 'smart');
create type public.shelf_sort as enum ('series', 'author', 'title', 'added', 'my_rating', 'public_rating', 'custom');

alter table public.shelves
  add column created_by uuid references public.profiles (id) on delete set null,
  add column visibility public.shelf_visibility not null default 'shared',
  add column kind public.shelf_kind not null default 'manual',
  add column rules jsonb,
  add column sort public.shelf_sort not null default 'series',
  add column icon text;

-- Existing shelves belong to the library owner, get a valid colour and a spaced-out row order.
update public.shelves s set created_by = l.owner_id from public.libraries l where l.id = s.library_id;

update public.shelves set color = 'spine-1' where color is null or color not in ('spine-1', 'spine-2', 'spine-3', 'spine-4', 'spine-5');
alter table public.shelves
  alter column color set default 'spine-1',
  alter column color set not null,
  add constraint shelves_color_check check (color in ('spine-1', 'spine-2', 'spine-3', 'spine-4', 'spine-5')),
  add constraint shelves_icon_check check (icon is null or char_length(icon) between 1 and 32),
  add constraint shelves_rules_check check (
    (kind = 'smart' and rules is not null and jsonb_typeof(rules) = 'object')
    or (kind = 'manual' and rules is null)
  ),
  -- A smart shelf's contents come from its rules, so it has no hand-made order.
  add constraint shelves_smart_sort_check check (kind = 'manual' or sort <> 'custom');

update public.shelves s set sort_order = r.n * 1024
from (
  select id, row_number() over (partition by library_id order by sort_order, created_at, id) as n
  from public.shelves
) r
where r.id = s.id;

-- Positions on a manual shelf use gaps (1024 apart) so a move rewrites one row.
update public.shelf_books sb set position = r.n * 1024
from (
  select shelf_id, book_id, row_number() over (partition by shelf_id order by position, book_id) as n
  from public.shelf_books
) r
where r.shelf_id = sb.shelf_id and r.book_id = sb.book_id;

create index shelves_created_by_idx on public.shelves (created_by);

-- ---------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER so policies on shelf_books can read shelves without recursing into RLS.
-- ---------------------------------------------------------------------------
create function public.shelf_kind_of(shelf uuid)
returns public.shelf_kind
language sql
stable
security definer
set search_path = ''
as $$
  select kind from public.shelves where id = shelf;
$$;

-- True when the user is a member and the shelf is shared, or private and theirs.
create function public.can_see_shelf(shelf uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select public.is_library_member(s.library_id, uid) and (s.visibility = 'shared' or s.created_by = uid)
    from public.shelves s where s.id = shelf
  ), false);
$$;

-- True when the user may change the shelf and its books: editors and owners for shared shelves,
-- the creator (any role, still a member) for private ones.
create function public.can_write_shelf(shelf uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case s.visibility
      when 'shared' then public.can_edit_library(s.library_id, uid)
      else s.created_by = uid and public.is_library_member(s.library_id, uid)
    end
    from public.shelves s where s.id = shelf
  ), false);
$$;

do $$
declare
  f text;
begin
  foreach f in array array['shelf_kind_of(uuid)', 'can_see_shelf(uuid, uuid)', 'can_write_shelf(uuid, uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers (these also bind the service role, which skips RLS)
-- ---------------------------------------------------------------------------

-- Fills created_by (the caller, else the library owner) and freezes kind, library and creator.
create function public.shelves_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(
      new.created_by,
      auth.uid(),
      (select owner_id from public.libraries where id = new.library_id)
    );
  else
    if new.kind <> old.kind or new.library_id <> old.library_id or new.created_by is distinct from old.created_by then
      raise exception 'a shelf''s kind, library and creator cannot change' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger shelves_guard before insert or update on public.shelves
  for each row execute function public.shelves_guard();

-- A shelf holds only books of its own library, and a smart shelf holds none.
create function public.shelf_books_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.shelf_kind_of(new.shelf_id) is distinct from 'manual' then
    raise exception 'books cannot be put on a smart shelf by hand' using errcode = '23514';
  end if;
  if public.book_library_id(new.book_id) is distinct from public.shelf_library_id(new.shelf_id) then
    raise exception 'a shelf can only hold books from its own library' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger shelf_books_guard before insert or update on public.shelf_books
  for each row execute function public.shelf_books_guard();

revoke all on function public.shelves_guard() from public, anon, authenticated;
revoke all on function public.shelf_books_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
drop policy shelves_select on public.shelves;
drop policy shelves_insert on public.shelves;
drop policy shelves_update on public.shelves;
drop policy shelves_delete on public.shelves;
drop policy shelf_books_select on public.shelf_books;
drop policy shelf_books_insert on public.shelf_books;
drop policy shelf_books_update on public.shelf_books;
drop policy shelf_books_delete on public.shelf_books;

-- Members see shared shelves; only the creator sees a private one.
create policy shelves_select on public.shelves for select to authenticated
  using (
    public.is_library_member(library_id, (select auth.uid()))
    and (visibility = 'shared' or created_by = (select auth.uid()))
  );

-- Shared: editors and owners. Private: its creator, in any role, and a member.
create policy shelves_insert on public.shelves for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and case visibility
      when 'shared' then public.can_edit_library(library_id, (select auth.uid()))
      else public.is_library_member(library_id, (select auth.uid()))
    end
  );
create policy shelves_update on public.shelves for update to authenticated
  using (
    case visibility
      when 'shared' then public.can_edit_library(library_id, (select auth.uid()))
      else created_by = (select auth.uid()) and public.is_library_member(library_id, (select auth.uid()))
    end
  )
  with check (
    case visibility
      when 'shared' then public.can_edit_library(library_id, (select auth.uid()))
      else created_by = (select auth.uid()) and public.is_library_member(library_id, (select auth.uid()))
    end
  );
create policy shelves_delete on public.shelves for delete to authenticated
  using (
    case visibility
      when 'shared' then public.can_edit_library(library_id, (select auth.uid()))
      else created_by = (select auth.uid()) and public.is_library_member(library_id, (select auth.uid()))
    end
  );

-- shelf_books follows its shelf. The guard trigger rejects smart shelves and books from another library.
create policy shelf_books_select on public.shelf_books for select to authenticated
  using (public.can_see_shelf(shelf_id, (select auth.uid())));
create policy shelf_books_insert on public.shelf_books for insert to authenticated
  with check (public.can_write_shelf(shelf_id, (select auth.uid())));
create policy shelf_books_update on public.shelf_books for update to authenticated
  using (public.can_write_shelf(shelf_id, (select auth.uid())))
  with check (public.can_write_shelf(shelf_id, (select auth.uid())));
create policy shelf_books_delete on public.shelf_books for delete to authenticated
  using (public.can_write_shelf(shelf_id, (select auth.uid())));
