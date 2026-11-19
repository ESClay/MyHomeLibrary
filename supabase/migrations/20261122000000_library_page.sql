-- Library paging in the database.
-- The library list and the shelves used to read every book and filter/sort in JS. `library_page` does the same filter and
-- sort in SQL and returns one page of book ids (plus the match total), so a request reads only the rows it shows.
-- The JS in src/lib/books/library-query.ts (matchesFilters / compareItems) stays the reference implementation;
-- supabase/tests/library_page.test.sql and src/lib/books/library-query.test.ts check both against the same fixture.

-- ---------------------------------------------------------------------------
-- Folding and sort keys
-- ---------------------------------------------------------------------------
-- JS `fold`: NFKD, strip combining marks U+0300-U+036F, lowercase. Postgres has the same primitives, so the result is
-- identical. (The `unaccent` extension is deliberately not used: it also rewrites letters NFKD leaves alone, such as
-- o-slash, sharp s and ae, so search results would differ from the JS reference.)
create function public.library_fold(t text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select lower(regexp_replace(normalize(t, nfkd), '[̀-ͯ]', '', 'g'));
$$;

-- JS `fold([title, ...authors, seriesName].join(" "))`, what `matchesQuery` searches. The subtitle is not searched there, so it is not here.
-- array_to_string is only STABLE in general; for text[] it is deterministic, so the wrapper is declared immutable
-- (the same approach as books_search_text).
create function public.books_search_folded(title text, authors text[], series_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select public.library_fold(coalesce(title, '') || ' ' || coalesce(array_to_string(authors, ' '), '') || ' ' || coalesce(series_name, ''));
$$;

-- JS `lastName(authors[0])`: the text before a comma (not at position 0), else the last word. A missing or empty
-- author is NULL, which sorts last ascending and first descending, exactly like JS's U+FFFF stand-in.
create function public.library_last_name(authors text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when a is null or a = '' then null
    when position(',' in a) > 1 then substr(a, 1, position(',' in a) - 1)
    else substring(regexp_replace(a, '^\s+|\s+$', '', 'g') from '(\S*)$')
  end
  from (select authors[1] as a) s;
$$;

-- ICU collation matching `new Intl.Collator("en", { sensitivity: "base", numeric: true })`:
-- primary strength only (case and accents ignored), digit runs compared as numbers ("2" before "10").
create collation public.library_sort (provider = icu, locale = 'en-u-kn-true-ks-level1', deterministic = false);

alter table public.books
  add column search_folded text generated always as (public.books_search_folded(title, authors, series_name)) stored,
  add column sort_title text collate public.library_sort generated always as (
    regexp_replace(title, '^(the|a|an)\s+', '', 'i')
  ) stored,
  add column sort_author text collate public.library_sort generated always as (
    public.library_last_name(authors)
  ) stored;

-- Search (every term a substring), default sort (added, newest first) and title sort.
create index books_search_folded_trgm_idx on public.books using gin (search_folded extensions.gin_trgm_ops);
create index books_library_added_idx on public.books (library_id, created_at desc, sort_title, id);
create index books_library_sort_title_idx on public.books (library_id, sort_title, id);

-- ---------------------------------------------------------------------------
-- library_page
-- ---------------------------------------------------------------------------
-- One page of book ids for a library, filtered and sorted like `applyLibraryQuery`, with the total match count.
-- Runs as the caller (security invoker): RLS on books, user_books, copies and loans decides what is visible, and
-- "me" is auth.uid(). Terms arrive already split on whitespace (JS folds them; they are folded again here, which is
-- idempotent). p_rating is a minimum rating as text ("3.5") or 'unrated'. p_book_ids restricts to a set of books
-- (a manual shelf). Every sort ends on books.id so pages never overlap or skip.
create function public.library_page(
  p_library_id uuid,
  p_terms text[] default null,
  p_my text default null,
  p_partner text default null,
  p_format text default null,
  p_own text default null,
  p_series text default null,
  p_loan text default null,
  p_rating text default null,
  p_sort text default 'added',
  p_dir text default null,
  p_offset integer default 0,
  p_limit integer default 48,
  p_book_ids uuid[] default null
)
returns table (book_id uuid, total bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_sort text := case when p_sort in ('added', 'title', 'author', 'series', 'myrating', 'rating', 'price') then p_sort else 'added' end;
  v_dir text := case
    when p_dir in ('asc', 'desc') then p_dir
    when v_sort in ('added', 'myrating', 'rating', 'price') then 'desc'
    else 'asc'
  end;
  v_min numeric := case when p_rating ~ '^[0-9]+(\.[0-9]+)?$' then p_rating::numeric end;
  v_patterns text[];
  v_where text := '';
  v_order text;
  v_mine constant text := '(select u.rating from public.user_books u where u.book_id = b.id and u.user_id = $3)';
  i integer;
begin
  select array_agg('%' || replace(replace(replace(public.library_fold(t), '\', '\\'), '%', '\%'), '_', '\_') || '%')
    into v_patterns
  from unnest(coalesce(p_terms, '{}')) t
  where btrim(t) <> '';

  for i in 1 .. coalesce(cardinality(v_patterns), 0) loop
    v_where := v_where || format(' and b.search_folded like ($12)[%s]', i);
  end loop;

  if p_my = 'none' then
    v_where := v_where || ' and not exists (select 1 from public.user_books u where u.book_id = b.id and u.user_id = $3)';
  elsif p_my is not null then
    v_where := v_where || ' and exists (select 1 from public.user_books u where u.book_id = b.id and u.user_id = $3 and u.status::text = $4)';
  end if;
  if p_partner is not null then
    v_where := v_where || ' and exists (select 1 from public.user_books u where u.book_id = b.id and u.user_id <> $3 and u.status::text = $5)';
  end if;
  if p_format is not null then
    v_where := v_where || ' and exists (select 1 from public.copies c where c.book_id = b.id and c.format::text = $6)';
  end if;
  if p_own is not null then
    v_where := v_where || ' and b.ownership::text = $7';
  end if;
  if p_series is not null then
    v_where := v_where || ' and b.series_name = $8';
  end if;

  -- isActive: returned_at is null. isOverdue: a due date whose UTC day is before today's UTC day (the due day itself is not overdue).
  if p_loan = 'out' then
    v_where := v_where || ' and exists (select 1 from public.loans l where l.book_id = b.id and l.returned_at is null and l.direction = ''out'')';
  elsif p_loan = 'overdue' then
    v_where := v_where || ' and exists (select 1 from public.loans l where l.book_id = b.id and l.returned_at is null and l.due_at is not null'
      || ' and (now() at time zone ''utc'')::date > (l.due_at at time zone ''utc'')::date)';
  elsif p_loan = 'borrowed' then
    v_where := v_where || ' and b.ownership = ''borrowed''';
  end if;

  if p_rating = 'unrated' then
    v_where := v_where || ' and not exists (select 1 from public.user_books u where u.book_id = b.id and u.user_id = $3 and u.rating is not null)';
  elsif v_min is not null then
    v_where := v_where || ' and coalesce(' || v_mine || ', 0) >= $9';
  end if;

  v_order := case v_sort
    when 'title' then format('b.sort_title %s, b.id', v_dir)
    when 'author' then format('b.sort_author %s, b.sort_title, b.id', v_dir)
    -- No series last whichever way it runs; then series name by direction, position by direction (nulls last), then title.
    when 'series' then format('(nullif(b.series_name, '''') is null), nullif(b.series_name, '''') collate public.library_sort %s, b.series_position %s nulls last, b.sort_title, b.id', v_dir, v_dir)
    when 'myrating' then format('%s %s nulls last, b.sort_title, b.id', v_mine, v_dir)
    when 'rating' then format('b.public_rating %s nulls last, b.sort_title, b.id', v_dir)
    when 'price' then format('(select sum(c.purchase_price) from public.copies c where c.book_id = b.id) %s nulls last, b.sort_title, b.id', v_dir)
    else format('b.created_at %s, b.sort_title, b.id', v_dir)
  end;

  return query execute
    'select b.id, count(*) over () from public.books b where b.library_id = $1 and ($2::uuid[] is null or b.id = any($2))'
    || v_where
    || ' order by ' || v_order
    || ' offset $10 limit $11'
    using p_library_id, p_book_ids, v_me, p_my, p_partner, p_format, p_own, p_series, v_min,
      greatest(coalesce(p_offset, 0), 0), least(greatest(coalesce(p_limit, 48), 0), 1000), v_patterns;
end;
$$;

-- The distinct series names in a library, for the series filter. Unsorted; the app sorts them.
create function public.library_series_names(p_library_id uuid)
returns setof text
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct b.series_name
  from public.books b
  where b.library_id = p_library_id and b.series_name is not null and b.series_name <> '';
$$;

revoke all on function public.library_page(uuid, text[], text, text, text, text, text, text, text, text, text, integer, integer, uuid[]) from public, anon;
revoke all on function public.library_series_names(uuid) from public, anon;
grant execute on function public.library_page(uuid, text[], text, text, text, text, text, text, text, text, text, integer, integer, uuid[]) to authenticated;
grant execute on function public.library_series_names(uuid) to authenticated;
