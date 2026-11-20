-- Rename (or merge) a series across a library in one statement.
-- Matches `p_from` against books.series_name with the same folding the library search uses (library_fold: NFKD, accents
-- stripped, lowercased), so "disney villains" and "Disney Villains" are one series. An RPC is used rather than
-- `.ilike` because ilike would not fold accents and needs wildcard escaping. If `p_author` is given, only books whose
-- first author has that last name (library_last_name, folded) are renamed, so two authors' same-named series stay apart.
-- security invoker: books RLS decides which rows the caller may change (owners and editors); nothing else is granted.
-- Returns the number of books renamed.
create function public.library_rename_series(
  p_library_id uuid,
  p_from text,
  p_to text,
  p_author text default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_to text := btrim(p_to);
  v_count integer;
begin
  if nullif(btrim(p_from), '') is null or nullif(v_to, '') is null then
    raise exception 'A series name is required';
  end if;
  update public.books b
  set series_name = v_to
  where b.library_id = p_library_id
    and b.series_name is not null
    and public.library_fold(btrim(b.series_name)) = public.library_fold(btrim(p_from))
    and (
      nullif(btrim(coalesce(p_author, '')), '') is null
      or public.library_fold(coalesce(public.library_last_name(b.authors), ''))
         = public.library_fold(coalesce(public.library_last_name(array[btrim(p_author)]), ''))
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.library_rename_series(uuid, text, text, text) from public, anon;
grant execute on function public.library_rename_series(uuid, text, text, text) to authenticated;
