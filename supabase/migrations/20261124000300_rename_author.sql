-- Author spelling tidy-up: rename an author across a library, and list the library's distinct authors so the app can
-- spot spellings that differ only by punctuation ("Gail Z Martin" and "Gail Z. Martin").

-- The folded form of a person's name: NFKD, accents stripped, lowercased (library_fold), then everything that is not a
-- letter or a digit removed, so case, accents, punctuation and spacing no longer matter. The JS twin is foldAuthor.
create function public.library_fold_name(t text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select regexp_replace(public.library_fold(t), '[^[:alnum:]]+', '', 'g');
$$;

-- Replaces every entry of books.authors[] (any position) whose folded name equals the folded p_from with p_to, for one
-- library, in one statement. If a book then lists the same person twice, the repeat is dropped (order kept).
-- security invoker: books RLS decides which rows the caller may change (owners and editors); nothing else is granted.
-- Returns the number of books changed (a book already spelled p_to is not counted).
create function public.library_rename_author(
  p_library_id uuid,
  p_from text,
  p_to text
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_to text := btrim(p_to);
  v_key text := public.library_fold_name(btrim(p_from));
  v_count integer;
begin
  if v_key = '' or nullif(v_to, '') is null then
    raise exception 'An author name is required';
  end if;
  update public.books b
  set authors = (
    select array_agg(r.name order by r.ord)
    from (
      select distinct on (public.library_fold_name(x.name)) x.name, x.ord
      from (
        select case when public.library_fold_name(t.a) = v_key then v_to else t.a end as name, t.ord
        from unnest(b.authors) with ordinality as t(a, ord)
      ) x
      order by public.library_fold_name(x.name), x.ord
    ) r
  )
  where b.library_id = p_library_id
    and exists (select 1 from unnest(b.authors) a where public.library_fold_name(a) = v_key and a <> v_to);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.library_rename_author(uuid, text, text) from public, anon;
grant execute on function public.library_rename_author(uuid, text, text) to authenticated;

-- Every distinct author spelling in a library with the number of books that list it. Unsorted; the app groups them.
-- security invoker: books RLS decides what is visible.
create function public.library_authors(p_library_id uuid)
returns table (author text, books bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.name, count(*)
  from public.books b, unnest(b.authors) as a(name)
  where b.library_id = p_library_id and btrim(a.name) <> ''
  group by a.name;
$$;

revoke all on function public.library_authors(uuid) from public, anon;
grant execute on function public.library_authors(uuid) to authenticated;
