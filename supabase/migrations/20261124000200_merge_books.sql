-- Merge several books of one library into one ("keeper").
--
-- SECURITY DEFINER, not invoker: user_books and reads belong to individual people, and RLS only lets a person write
-- their own rows. A merge has to move the partner's reading records too; as invoker those updates would silently
-- match nothing and deleting the merged books would then cascade the partner's ratings and notes away. So the function
-- checks the caller itself (signed in, and owner or editor of the books' library) and does the whole job in one
-- transaction. search_path is empty and every name is schema-qualified.
--
-- What moves: copies (price history follows), reads, loans, shelf_books, user_books (merged per person).
-- What fills: the keeper's empty book fields, in the order the ids were given. Then the merged books are deleted and
-- calibre_uuid (unique per library) moves if the keeper has none.
-- Returns counts as jsonb: copies, reads, loans, shelves, reading_records (user_books rows moved or folded), removed.

create function public.merge_books(
  p_keep uuid,
  p_merge uuid[],
  p_cover_from uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_lib uuid;
  v_all uuid[];
  v_keep public.books;
  v_src public.books;
  v_n_found integer;
  v_cover text;
  v_calibre text;
  v_own public.book_ownership;
  v_copies integer;
  v_reads integer;
  v_loans integer;
  v_shelves integer;
  v_records integer;
  v_active_in integer;
  v_libs integer;
begin
  if v_me is null then
    raise exception 'Sign in to merge books' using errcode = '28000';
  end if;
  if p_keep is null or p_merge is null then
    raise exception 'Choose the book to keep and the books to merge';
  end if;
  if coalesce(array_length(p_merge, 1), 0) < 1 or array_length(p_merge, 1) > 9 then
    raise exception 'Merge between 2 and 10 books';
  end if;
  if p_keep = any (p_merge) then
    raise exception 'The book to keep cannot also be merged away';
  end if;
  if (select count(distinct m) from unnest(p_merge) m) <> array_length(p_merge, 1) or exists (select 1 from unnest(p_merge) m where m is null) then
    raise exception 'Each book can be listed only once';
  end if;
  if p_cover_from is not null and p_cover_from <> p_keep and not p_cover_from = any (p_merge) then
    raise exception 'The cover must come from one of the selected books';
  end if;

  v_all := p_merge || p_keep;
  select count(*), min(library_id::text)::uuid, count(distinct library_id)
    into v_n_found, v_lib, v_libs
  from public.books where id = any (v_all);
  if v_n_found <> array_length(v_all, 1) then
    raise exception 'Some of those books no longer exist';
  end if;
  if v_libs <> 1 then
    raise exception 'Books from different libraries cannot be merged';
  end if;
  if not public.can_edit_library(v_lib, v_me) then
    raise exception 'Only owners and editors can merge books' using errcode = '42501';
  end if;

  -- Lock the books so two merges cannot interleave.
  perform 1 from public.books where id = any (v_all) order by id for update;

  -- Only one active "borrowed from" loan may exist per book (loans_one_active_in_idx).
  select count(*) into v_active_in
  from public.loans
  where book_id = any (v_all) and direction = 'in' and returned_at is null;
  if v_active_in > 1 then
    raise exception 'More than one of these books is on loan from someone right now. Return all but one first, then merge.'
      using errcode = '23505';
  end if;

  select * into v_keep from public.books where id = p_keep;

  -- Copies, reads and loans move to the keeper. Copies first: a loan out derives its book from its copy.
  update public.copies set book_id = p_keep where book_id = any (p_merge);
  get diagnostics v_copies = row_count;
  update public.reads set book_id = p_keep where book_id = any (p_merge);
  get diagnostics v_reads = row_count;
  update public.loans set book_id = p_keep where book_id = any (p_merge);
  get diagnostics v_loans = row_count;

  -- Shelves: the keeper takes the best (lowest) position its merged books had on each manual shelf it is not on yet.
  insert into public.shelf_books (shelf_id, book_id, position)
  select shelf_id, p_keep, min(position)
  from public.shelf_books
  where book_id = any (p_merge)
  group by shelf_id
  on conflict (shelf_id, book_id) do nothing;
  get diagnostics v_shelves = row_count;
  delete from public.shelf_books where book_id = any (p_merge);

  -- user_books, per person. The keeper's own row wins; its empty rating is filled from the others in selection order,
  -- notes are joined with a blank line, and status is the most advanced one (read > reading > dnf > want).
  select count(*) into v_records from public.user_books where book_id = any (p_merge);
  with src as (
    select u.*, case when u.book_id = p_keep then 0 else m.ord end as ord
    from public.user_books u
    left join unnest(p_merge) with ordinality as m(id, ord) on m.id = u.book_id
    where u.book_id = any (v_all)
  ),
  folded as (
    select
      user_id,
      (array_agg(status order by case status when 'read' then 4 when 'reading' then 3 when 'dnf' then 2 else 1 end desc))[1] as status,
      (array_agg(rating order by ord) filter (where rating is not null))[1] as rating,
      string_agg(notes, E'\n\n' order by ord) filter (where nullif(btrim(notes), '') is not null) as notes
    from src
    group by user_id
  )
  insert into public.user_books (user_id, book_id, status, rating, notes)
  select user_id, p_keep, status, rating, notes from folded
  on conflict (user_id, book_id) do update
    set status = excluded.status, rating = excluded.rating, notes = excluded.notes;

  -- Fill the keeper's empty book fields. Read from the merged books before they are deleted.
  update public.books k set
    subtitle         = coalesce(nullif(btrim(k.subtitle), ''), (select s.subtitle from public.books s join unnest(p_merge) with ordinality m(id, o) on m.id = s.id where nullif(btrim(s.subtitle), '') is not null order by m.o limit 1)),
    description      = coalesce(nullif(btrim(k.description), ''), (select s.description from public.books s join unnest(p_merge) with ordinality m(id, o) on m.id = s.id where nullif(btrim(s.description), '') is not null order by m.o limit 1)),
    page_count       = coalesce(k.page_count, (select s.page_count from public.books s join unnest(p_merge) with ordinality m(id, o) on m.id = s.id where s.page_count is not null order by m.o limit 1)),
    published_date   = coalesce(nullif(btrim(k.published_date), ''), (select s.published_date from public.books s join unnest(p_merge) with ordinality m(id, o) on m.id = s.id where nullif(btrim(s.published_date), '') is not null order by m.o limit 1)),
    genres           = case when coalesce(array_length(k.genres, 1), 0) > 0 then k.genres
                            else coalesce((select s.genres from public.books s join unnest(p_merge) with ordinality m(id, o) on m.id = s.id where coalesce(array_length(s.genres, 1), 0) > 0 order by m.o limit 1), k.genres) end,
    authors          = case when coalesce(array_length(k.authors, 1), 0) > 0 then k.authors
                            else coalesce((select s.authors from public.books s join unnest(p_merge) with ordinality m(id, o) on m.id = s.id where coalesce(array_length(s.authors, 1), 0) > 0 order by m.o limit 1), k.authors) end,
    isbn13           = coalesce(nullif(btrim(k.isbn13), ''), (select s.isbn13 from public.books s join unnest(p_merge) with ordinality m(id, o) on m.id = s.id where nullif(btrim(s.isbn13), '') is not null order by m.o limit 1)),
    hardcover_id     = coalesce(k.hardcover_id, (select s.hardcover_id from public.books s join unnest(p_merge) with ordinality m(id, o) on m.id = s.id where s.hardcover_id is not null order by m.o limit 1)),
    google_books_id  = coalesce(nullif(btrim(k.google_books_id), ''), (select s.google_books_id from public.books s join unnest(p_merge) with ordinality m(id, o) on m.id = s.id where nullif(btrim(s.google_books_id), '') is not null order by m.o limit 1)),
    ol_key           = coalesce(nullif(btrim(k.ol_key), ''), (select s.ol_key from public.books s join unnest(p_merge) with ordinality m(id, o) on m.id = s.id where nullif(btrim(s.ol_key), '') is not null order by m.o limit 1))
  where k.id = p_keep;

  -- Series travels as a group so the name never ends up with another book's number: link, name and number come from
  -- the first merged book that has any, only when the keeper has no series at all. If the keeper has a name but no
  -- number, the number comes from the first merged book with the same name (case and accents ignored).
  if v_keep.series_id is null and nullif(btrim(coalesce(v_keep.series_name, '')), '') is null then
    select s.* into v_src
    from public.books s join unnest(p_merge) with ordinality m(id, o) on m.id = s.id
    where s.series_id is not null or nullif(btrim(coalesce(s.series_name, '')), '') is not null
    order by m.o limit 1;
    if v_src.id is not null then
      update public.books set series_id = v_src.series_id, series_name = v_src.series_name, series_position = v_src.series_position
      where id = p_keep;
    end if;
  elsif v_keep.series_position is null then
    update public.books k set series_position = (
      select s.series_position
      from public.books s join unnest(p_merge) with ordinality m(id, o) on m.id = s.id
      where s.series_position is not null
        and public.library_fold(btrim(coalesce(s.series_name, ''))) = public.library_fold(btrim(coalesce(k.series_name, '')))
      order by m.o limit 1)
    where k.id = p_keep and nullif(btrim(coalesce(k.series_name, '')), '') is not null;
  end if;

  -- The public rating travels as a group too (value, count, source).
  if v_keep.public_rating is null then
    update public.books k set
      public_rating = s.public_rating, public_rating_count = s.public_rating_count, rating_source = s.rating_source
    from (
      select b.public_rating, b.public_rating_count, b.rating_source
      from public.books b join unnest(p_merge) with ordinality m(id, o) on m.id = b.id
      where b.public_rating is not null order by m.o limit 1
    ) s
    where k.id = p_keep;
  end if;

  -- Cover: the chosen book's, else the keeper's own, else the first merged book that has one.
  if p_cover_from is not null then
    select nullif(btrim(cover_url), '') into v_cover from public.books where id = p_cover_from;
  end if;
  if v_cover is null then
    select coalesce(
      nullif(btrim(v_keep.cover_url), ''),
      (select nullif(btrim(s.cover_url), '') from public.books s join unnest(p_merge) with ordinality m(id, o) on m.id = s.id where nullif(btrim(s.cover_url), '') is not null order by m.o limit 1)
    ) into v_cover;
  end if;

  -- Ownership: owned beats borrowed beats wishlist, so a wishlist entry can never hide an owned book.
  select case
    when bool_or(ownership = 'owned') then 'owned'
    when bool_or(ownership = 'borrowed') then 'borrowed'
    else 'wishlist'
  end::public.book_ownership into v_own
  from public.books where id = any (v_all);

  select calibre_uuid into v_calibre
  from public.books s join unnest(p_merge) with ordinality m(id, o) on m.id = s.id
  where nullif(btrim(coalesce(s.calibre_uuid, '')), '') is not null order by m.o limit 1;

  -- Delete the merged books (their remaining rows, such as other people's private shelf entries, cascade).
  delete from public.books where id = any (p_merge);

  update public.books set
    cover_url = v_cover,
    ownership = v_own,
    calibre_uuid = coalesce(calibre_uuid, v_calibre)
  where id = p_keep;

  return jsonb_build_object(
    'copies', v_copies,
    'reads', v_reads,
    'loans', v_loans,
    'shelves', v_shelves,
    'reading_records', v_records,
    'removed', array_length(p_merge, 1)
  );
end;
$$;

revoke all on function public.merge_books(uuid, uuid[], uuid) from public, anon;
grant execute on function public.merge_books(uuid, uuid[], uuid) to authenticated;
