-- Author sort: last name, full name, then the author's series in reading order, standalones last (always ascending).
-- The invalid-sort fallback is now 'author', matching the app's new default. Same signature as 20261122000000_library_page.sql,
-- so grants carry over. src/lib/books/library-query.ts (compareByKey) is the JS reference and must stay in step.

create or replace function public.library_page(
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
  v_sort text := case when p_sort in ('added', 'title', 'author', 'series', 'myrating', 'rating', 'price') then p_sort else 'author' end;
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
    -- Last name, then full name (both by direction, so two Smiths stay apart), then no series after series, series name,
    -- and position, always ascending (position is numeric: a novella at 2.5 sits between 2 and 3). A missing or empty
    -- author is NULL in both author keys (like JS's U+FFFF stand-in): last ascending, first descending.
    when 'author' then format('b.sort_author %s, (nullif(b.authors[1], '''') collate public.library_sort) %s, (nullif(b.series_name, '''') is null), nullif(b.series_name, '''') collate public.library_sort asc, b.series_position asc nulls last, b.sort_title, b.id', v_dir, v_dir)
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
