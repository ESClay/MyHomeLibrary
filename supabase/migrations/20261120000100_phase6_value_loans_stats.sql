-- Phase 6: region/locale, eBay pricing columns, loans and borrowers, stats RPCs.
-- Apply with `supabase db push`. Does not edit earlier migrations.

-- ---------------------------------------------------------------------------
-- Region and locale
--   profiles.region      an eBay marketplace id such as EBAY_CA (null until the person chooses)
--   profiles.locale      a BCP-47 tag such as en-CA, drives date/number/currency formatting
--   libraries.price_region  the marketplace (and so the currency) all prices in the library use
-- The allowed marketplace ids live in src/lib/regions.ts; the database only checks the shape, so adding a
-- marketplace never needs a migration.
-- ---------------------------------------------------------------------------
alter table public.profiles add column region text check (region is null or region ~ '^EBAY_[A-Z]{2}$');
alter table public.profiles add column locale text check (locale is null or locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$');
alter table public.libraries add column price_region text check (price_region is null or price_region ~ '^EBAY_[A-Z]{2}$');

-- Sign-up passes region and locale in the user metadata. The trigger copies them when they have the right
-- shape and ignores them otherwise, so a bad value can never make sign-up fail.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta_region text := new.raw_user_meta_data ->> 'region';
  meta_locale text := new.raw_user_meta_data ->> 'locale';
begin
  insert into public.profiles (id, email, display_name, avatar_url, region, locale)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(new.email, '@', 1)
    ),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    case when meta_region ~ '^EBAY_[A-Z]{2}$' then meta_region end,
    case when meta_locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' then meta_locale end
  );
  return new;
end;
$$;

-- A new library prices in its creator's region unless one is given. Existing libraries are NOT backfilled here:
-- today's profiles have no region yet. The app fills price_region for a person's libraries the moment they
-- choose their region (see setRegion), and until then prices stay off for that library.
create function public.default_library_price_region()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.price_region is null then
    select p.region into new.price_region from public.profiles p where p.id = new.owner_id;
  end if;
  return new;
end;
$$;
revoke all on function public.default_library_price_region() from public, anon;
grant execute on function public.default_library_price_region() to authenticated, service_role;

create trigger libraries_default_price_region
  before insert on public.libraries
  for each row execute function public.default_library_price_region();

-- Backfill any library whose owner already has a region (none today, but safe to re-run on a copy of the data).
update public.libraries l
set price_region = p.region
from public.profiles p
where p.id = l.owner_id and l.price_region is null and p.region is not null;

-- ---------------------------------------------------------------------------
-- Prices
-- ---------------------------------------------------------------------------
alter table public.copies add column current_price_currency text check (current_price_currency is null or current_price_currency ~ '^[A-Z]{3}$');
alter table public.copies add column price_approximate boolean not null default false;
alter table public.copies add column price_listing_count integer check (price_listing_count is null or price_listing_count >= 0);

alter table public.price_history add column currency text check (currency is null or currency ~ '^[A-Z]{3}$');
alter table public.price_history add column approximate boolean not null default false;
alter table public.price_history add column listing_count integer check (listing_count is null or listing_count >= 0);

-- One row per on-demand price check, so the per-person daily cap can be counted. Own rows only.
create table public.price_check_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  copy_id uuid references public.copies (id) on delete set null,
  checked_at timestamptz not null default now()
);
create index price_check_log_user_idx on public.price_check_log (user_id, checked_at desc);
alter table public.price_check_log enable row level security;
create policy price_check_log_select on public.price_check_log for select to authenticated
  using (user_id = (select auth.uid()));
create policy price_check_log_insert on public.price_check_log for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Physical copies with an ISBN that are due a price check, stalest first. Used by the daily cron job (service role).
-- Copies of libraries with no price_region are left out: prices are off for them.
create function public.price_refresh_candidates(cutoff timestamptz, max_rows integer)
returns table (copy_id uuid, format public.book_format, condition public.book_condition, isbn text, price_region text, price_checked_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.format, c.condition, coalesce(nullif(c.edition_isbn, ''), nullif(b.isbn13, '')), l.price_region, c.price_checked_at
  from public.copies c
  join public.books b on b.id = c.book_id
  join public.libraries l on l.id = b.library_id
  where c.format in ('hardcover', 'paperback')
    and b.ownership = 'owned'
    and l.price_region is not null
    and coalesce(nullif(c.edition_isbn, ''), nullif(b.isbn13, '')) is not null
    and (c.price_checked_at is null or c.price_checked_at < cutoff)
  order by c.price_checked_at asc nulls first, c.id
  limit greatest(max_rows, 0);
$$;
revoke all on function public.price_refresh_candidates(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.price_refresh_candidates(timestamptz, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Borrowers and loans
-- ---------------------------------------------------------------------------
create table public.borrowers (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create unique index borrowers_library_name_idx on public.borrowers (library_id, lower(btrim(name)));
alter table public.borrowers enable row level security;

create policy borrowers_select on public.borrowers for select to authenticated
  using (public.is_library_member(library_id, (select auth.uid())));
create policy borrowers_insert on public.borrowers for insert to authenticated
  with check (public.can_edit_library(library_id, (select auth.uid())));
create policy borrowers_update on public.borrowers for update to authenticated
  using (public.can_edit_library(library_id, (select auth.uid())))
  with check (public.can_edit_library(library_id, (select auth.uid())));
create policy borrowers_delete on public.borrowers for delete to authenticated
  using (public.can_edit_library(library_id, (select auth.uid())));

-- Loans: direction 'out' = one of our copies lent to a borrower; 'in' = a book we borrowed from someone.
alter table public.loans add column direction public.loan_direction not null default 'out';
alter table public.loans add column borrower_id uuid references public.borrowers (id) on delete restrict;
alter table public.loans add column book_id uuid references public.books (id) on delete cascade;
alter table public.loans add column library_id uuid references public.libraries (id) on delete cascade;
alter table public.loans alter column copy_id drop not null;

-- Carry the old free-text borrower names over to real borrowers.
update public.loans lo
set book_id = c.book_id, library_id = b.library_id
from public.copies c
join public.books b on b.id = c.book_id
where c.id = lo.copy_id;

insert into public.borrowers (library_id, name)
select distinct lo.library_id, btrim(lo.borrower_name)
from public.loans lo
where lo.borrower_name is not null and btrim(lo.borrower_name) <> '' and lo.library_id is not null
on conflict do nothing;

update public.loans lo
set borrower_id = br.id
from public.borrowers br
where br.library_id = lo.library_id and lower(btrim(br.name)) = lower(btrim(lo.borrower_name));

alter table public.loans drop column borrower_name;
alter table public.loans alter column library_id set not null;
alter table public.loans alter column book_id set not null;
alter table public.loans alter column borrower_id set not null;

alter table public.loans add constraint loans_direction_shape check (
  (direction = 'out' and copy_id is not null)
  or (direction = 'in' and copy_id is null)
);
alter table public.loans add constraint loans_returned_after_loaned check (returned_at is null or returned_at >= loaned_at);

drop index public.loans_open_idx;
-- At most one active loan per copy (lent out), and one active borrow per book.
create unique index loans_one_active_out_idx on public.loans (copy_id) where direction = 'out' and returned_at is null;
create unique index loans_one_active_in_idx on public.loans (book_id) where direction = 'in' and returned_at is null;
create index loans_book_id_idx on public.loans (book_id);
create index loans_library_active_idx on public.loans (library_id) where returned_at is null;
create index loans_borrower_id_idx on public.loans (borrower_id);

-- Derives book_id and library_id (never trusted from the client) and enforces the cross-row rules:
--   out: the copy exists, and the borrower belongs to the copy's library
--   in:  the book is ownership 'borrowed' (checked when the loan is created) and the borrower belongs to the book's library
create function public.loans_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b_id uuid;
  lib uuid;
  own public.book_ownership;
  br_lib uuid;
begin
  if new.direction = 'out' then
    select c.book_id, bk.library_id into b_id, lib
    from public.copies c join public.books bk on bk.id = c.book_id
    where c.id = new.copy_id;
    if lib is null then
      raise exception 'A loan out needs one of our copies' using errcode = '23514';
    end if;
    new.book_id := b_id;
  else
    new.copy_id := null;
    select bk.library_id, bk.ownership into lib, own from public.books bk where bk.id = new.book_id;
    if lib is null then
      raise exception 'A borrowed loan needs a book' using errcode = '23514';
    end if;
    if tg_op = 'INSERT' and own is distinct from 'borrowed' then
      raise exception 'A loan in needs a book marked as borrowed' using errcode = '23514';
    end if;
  end if;
  new.library_id := lib;

  select br.library_id into br_lib from public.borrowers br where br.id = new.borrower_id;
  if br_lib is distinct from lib then
    raise exception 'The borrower belongs to a different library' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.loans_validate() from public, anon;
grant execute on function public.loans_validate() to authenticated, service_role;

create trigger loans_validate before insert or update on public.loans
  for each row execute function public.loans_validate();

drop policy loans_select on public.loans;
drop policy loans_insert on public.loans;
drop policy loans_update on public.loans;
drop policy loans_delete on public.loans;

-- Members read; owners and editors write. library_id is set by the trigger above, so a loan can never name a
-- library other than the one its copy or book is in.
create policy loans_select on public.loans for select to authenticated
  using (public.is_library_member(library_id, (select auth.uid())));
create policy loans_insert on public.loans for insert to authenticated
  with check (public.can_edit_library(library_id, (select auth.uid())));
create policy loans_update on public.loans for update to authenticated
  using (public.can_edit_library(library_id, (select auth.uid())))
  with check (public.can_edit_library(library_id, (select auth.uid())));
create policy loans_delete on public.loans for delete to authenticated
  using (public.can_edit_library(library_id, (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Stats RPCs. Plain SQL functions that run as the caller (security invoker), so RLS decides what is counted:
-- a non-member passing someone else's library id gets nothing back.
-- ---------------------------------------------------------------------------

-- Books and pages finished, per person per month.
create function public.stats_reading(lib uuid)
returns table (user_id uuid, month date, books bigint, pages bigint)
language sql stable security invoker set search_path = ''
as $$
  select r.user_id, date_trunc('month', r.finished_at)::date, count(*), coalesce(sum(b.page_count), 0)::bigint
  from public.reads r
  join public.books b on b.id = r.book_id
  where b.library_id = lib and r.finished_at is not null
  group by 1, 2
  order by 2, 1;
$$;

-- Library value over physical, owned copies, counting only prices in one currency.
create function public.stats_value(lib uuid, cur text)
returns table (copies bigint, priced bigint, unpriced bigint, other_currency bigint, est_value numeric, paid numeric, paid_priced numeric)
language sql stable security invoker set search_path = ''
as $$
  select
    count(*),
    count(*) filter (where c.current_price is not null and c.current_price_currency = cur),
    count(*) filter (where c.current_price is null),
    count(*) filter (where c.current_price is not null and c.current_price_currency is distinct from cur),
    coalesce(sum(c.current_price) filter (where c.current_price_currency = cur), 0),
    coalesce(sum(c.purchase_price), 0),
    coalesce(sum(c.purchase_price) filter (where c.current_price is not null and c.current_price_currency = cur), 0)
  from public.copies c
  join public.books b on b.id = c.book_id
  where b.library_id = lib and b.ownership = 'owned' and c.format in ('hardcover', 'paperback');
$$;

-- The same, per shelf the caller can see (manual shelves; smart shelves have no stored members).
create function public.stats_value_by_shelf(lib uuid, cur text)
returns table (shelf_id uuid, shelf_name text, copies bigint, priced bigint, est_value numeric, paid numeric)
language sql stable security invoker set search_path = ''
as $$
  select s.id, s.name, count(c.id),
    count(c.id) filter (where c.current_price is not null and c.current_price_currency = cur),
    coalesce(sum(c.current_price) filter (where c.current_price_currency = cur), 0),
    coalesce(sum(c.purchase_price), 0)
  from public.shelves s
  join public.shelf_books sb on sb.shelf_id = s.id
  join public.books b on b.id = sb.book_id and b.ownership = 'owned'
  join public.copies c on c.book_id = b.id and c.format in ('hardcover', 'paperback')
  where s.library_id = lib and s.kind = 'manual'
  group by s.id, s.name
  having count(c.id) > 0
  order by 5 desc, s.name;
$$;

-- The ten most valuable copies (in the library currency).
create function public.stats_top_copies(lib uuid, cur text)
returns table (copy_id uuid, book_id uuid, title text, authors text[], cover_url text, format public.book_format, price numeric, paid numeric, approximate boolean)
language sql stable security invoker set search_path = ''
as $$
  select c.id, b.id, b.title, b.authors, b.cover_url, c.format, c.current_price, c.purchase_price, c.price_approximate
  from public.copies c
  join public.books b on b.id = c.book_id
  where b.library_id = lib and b.ownership = 'owned' and c.format in ('hardcover', 'paperback')
    and c.current_price is not null and c.current_price_currency = cur
  order by c.current_price desc, b.title
  limit 10;
$$;

-- Top authors, genres and series by number of books (owned and wishlist, not borrowed).
create function public.stats_top(lib uuid, kind text, max_rows integer default 8)
returns table (label text, books bigint)
language sql stable security invoker set search_path = ''
as $$
  select t.label, count(distinct t.id) from (
    select b.id, a as label from public.books b, unnest(b.authors) as a
      where kind = 'author' and b.library_id = lib and b.ownership <> 'borrowed'
    union all
    select b.id, g from public.books b, unnest(b.genres) as g
      where kind = 'genre' and b.library_id = lib and b.ownership <> 'borrowed'
    union all
    select b.id, b.series_name from public.books b
      where kind = 'series' and b.library_id = lib and b.ownership <> 'borrowed'
  ) t
  where t.label is not null and btrim(t.label) <> ''
  group by t.label
  order by 2 desc, 1
  limit greatest(max_rows, 0);
$$;

-- Ratings per person in half-star steps (times two, so 1..10).
create function public.stats_ratings(lib uuid)
returns table (user_id uuid, half_stars integer, books bigint)
language sql stable security invoker set search_path = ''
as $$
  select u.user_id, (u.rating * 2)::integer, count(*)
  from public.user_books u
  join public.books b on b.id = u.book_id
  where b.library_id = lib and u.rating is not null
  group by 1, 2
  order by 1, 2;
$$;

-- Copies by format (owned books).
create function public.stats_formats(lib uuid)
returns table (format public.book_format, copies bigint)
language sql stable security invoker set search_path = ''
as $$
  select c.format, count(*)
  from public.copies c
  join public.books b on b.id = c.book_id
  where b.library_id = lib and b.ownership = 'owned'
  group by 1
  order by 2 desc;
$$;

-- Books added per month, split by ownership.
create function public.stats_added(lib uuid)
returns table (month date, ownership public.book_ownership, books bigint)
language sql stable security invoker set search_path = ''
as $$
  select date_trunc('month', b.created_at)::date, b.ownership, count(*)
  from public.books b
  where b.library_id = lib
  group by 1, 2
  order by 1, 2;
$$;

-- Per member: owned books, and how many of them they have not marked read.
create function public.stats_unread(lib uuid)
returns table (user_id uuid, owned bigint, read bigint, reading bigint, unread bigint)
language sql stable security invoker set search_path = ''
as $$
  select m.user_id,
    count(b.id),
    count(b.id) filter (where u.status = 'read'),
    count(b.id) filter (where u.status = 'reading'),
    count(b.id) filter (where u.status is distinct from 'read')
  from public.library_members m
  cross join public.books b
  left join public.user_books u on u.book_id = b.id and u.user_id = m.user_id
  where m.library_id = lib and b.library_id = lib and b.ownership = 'owned'
  group by m.user_id;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'stats_reading(uuid)', 'stats_value(uuid, text)', 'stats_value_by_shelf(uuid, text)', 'stats_top_copies(uuid, text)',
    'stats_top(uuid, text, integer)', 'stats_ratings(uuid)', 'stats_formats(uuid)', 'stats_added(uuid)', 'stats_unread(uuid)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end;
$$;
