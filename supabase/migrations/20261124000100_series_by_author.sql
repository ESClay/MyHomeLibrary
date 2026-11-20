-- The distinct (series name, first author) pairs in a library, for the series field's suggestions: a book's own
-- author's series are listed first. Unsorted; the app ranks them. security invoker: books RLS decides what is visible.
create function public.library_series_by_author(p_library_id uuid)
returns table (series_name text, author text)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct b.series_name, coalesce(b.authors[1], '') as author
  from public.books b
  where b.library_id = p_library_id and b.series_name is not null and b.series_name <> '';
$$;

revoke all on function public.library_series_by_author(uuid) from public, anon;
grant execute on function public.library_series_by_author(uuid) to authenticated;
