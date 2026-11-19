-- library_page: the SQL filter, sort and paging behind the library list and the shelves. Run with `npx supabase test db`.
-- The fixture (13 books) and every expected order below mirror src/lib/books/library-fixture.ts, which the vitest
-- suite checks against the JS reference (applyLibraryQuery). Book numbers n are the last digits of the book id.
-- Fixtures: alice owns the library, bob is an editor, carol a viewer, eve belongs to nothing. All rolled back.
begin;
select plan(70);

insert into auth.users (id, aud, role, email) values
  ('a0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'alice@example.com'),
  ('b0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'bob@example.com'),
  ('c0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'carol@example.com'),
  ('e0000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'eve@example.com');

insert into public.libraries (id, name, owner_id) values ('10000000-0000-0000-0000-0000000000f0', 'Fixture library', 'a0000000-0000-0000-0000-000000000001');
insert into public.library_members (library_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000f0', 'b0000000-0000-0000-0000-000000000002', 'editor'),
  ('10000000-0000-0000-0000-0000000000f0', 'c0000000-0000-0000-0000-000000000003', 'viewer');

insert into public.books (id, library_id, title, authors, series_name, series_position, ownership, public_rating, created_at) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000f0', 'The Hobbit', '{"Tolkien, J. R. R."}', 'Middle-earth', 1, 'owned', 4.5, '2026-01-01T10:00:00Z'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000f0', 'The Fellowship of the Ring', '{"J. R. R. Tolkien"}', 'Middle-earth', 2, 'owned', 4.4, '2026-01-02T10:00:00Z'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-0000000000f0', 'Éclair Études', '{"Zoë Brontë"}', null, null, 'owned', null, '2026-01-03T10:00:00Z'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-0000000000f0', 'A Tale of Two Cities', '{"Charles Dickens"}', null, null, 'owned', 3.9, '2026-01-04T10:00:00Z'),
  ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-0000000000f0', 'Book 2', '{"Ann Alpha"}', 'Saga', 2, 'wishlist', 4, '2026-01-05T10:00:00Z'),
  ('30000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-0000000000f0', 'Book 10', '{"Ann Alpha"}', 'Saga', 10, 'wishlist', 4, '2026-01-06T10:00:00Z'),
  ('30000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-0000000000f0', 'An Anthology', '{}', null, null, 'owned', 2, '2026-01-07T10:00:00Z'),
  ('30000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-0000000000f0', 'Returned Book', '{"Dickens, Monica"}', 'Saga', 1, 'owned', null, '2026-01-08T10:00:00Z'),
  ('30000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-0000000000f0', 'Borrowed Book', '{"Mary Moon"}', null, null, 'borrowed', 3, '2026-01-09T10:00:00Z'),
  ('30000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-0000000000f0', 'Twin Title', '{"Zed Zimmer"}', 'Saga', null, 'owned', 3, '2026-01-10T10:00:00Z'),
  ('30000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-0000000000f0', 'twin title', '{"Zed Zimmer"}', 'Saga', null, 'owned', 3, '2026-01-10T10:00:00Z'),
  ('30000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-0000000000f0', 'The Zebra', '{"Zora Neale"}', null, null, 'owned', 5, '2026-01-11T10:00:00Z'),
  ('30000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-0000000000f0', '100% Pure', '{"Pat Percent"}', null, null, 'owned', null, '2026-01-12T10:00:00Z');

insert into public.copies (id, book_id, format, purchase_price) values
  ('40000000-0000-0000-0000-000000000101', '30000000-0000-0000-0000-000000000001', 'hardcover', 12.5),
  ('40000000-0000-0000-0000-000000000102', '30000000-0000-0000-0000-000000000001', 'ebook', null),
  ('40000000-0000-0000-0000-000000000201', '30000000-0000-0000-0000-000000000002', 'paperback', 9),
  ('40000000-0000-0000-0000-000000000301', '30000000-0000-0000-0000-000000000003', 'ebook', null),
  ('40000000-0000-0000-0000-000000000401', '30000000-0000-0000-0000-000000000004', 'paperback', 5),
  ('40000000-0000-0000-0000-000000000402', '30000000-0000-0000-0000-000000000004', 'paperback', 3.25),
  ('40000000-0000-0000-0000-000000000701', '30000000-0000-0000-0000-000000000007', 'audiobook', 20),
  ('40000000-0000-0000-0000-000000000801', '30000000-0000-0000-0000-000000000008', 'hardcover', 7),
  ('40000000-0000-0000-0000-000000001001', '30000000-0000-0000-0000-000000000010', 'paperback', 10),
  ('40000000-0000-0000-0000-000000001201', '30000000-0000-0000-0000-000000000012', 'paperback', 10);

insert into public.user_books (user_id, book_id, status, rating) values
  ('a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'read', 5),
  ('a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'reading', 4),
  ('a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'want', null),
  ('a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000007', 'dnf', 2.5),
  ('a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000008', 'read', 3.5),
  ('a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000009', 'want', 1),
  ('a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000011', 'read', 5),
  ('b0000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'read', null),
  ('b0000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'reading', null),
  ('b0000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000004', 'want', null),
  ('b0000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000008', 'reading', null);

insert into public.borrowers (id, library_id, name) values ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000f0', 'Sam');
-- n2: lent, due far ahead. n4: lent, long overdue. n8: lent but already returned (not active). n9: borrowed from Sam, overdue.
insert into public.loans (direction, copy_id, book_id, borrower_id, loaned_at, due_at, returned_at) values
  ('out', '40000000-0000-0000-0000-000000000201', '30000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '2019-12-01', '2099-01-01', null),
  ('out', '40000000-0000-0000-0000-000000000401', '30000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000001', '2019-12-01', '2020-01-01', null),
  ('out', '40000000-0000-0000-0000-000000000801', '30000000-0000-0000-0000-000000000008', '50000000-0000-0000-0000-000000000001', '2019-12-01', '2020-01-01', '2019-12-15'),
  ('in', null, '30000000-0000-0000-0000-000000000009', '50000000-0000-0000-0000-000000000001', '2019-12-01', '2020-01-01', null);

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;
create function pg_temp.act_as_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- The fixture book numbers library_page returns, in order.
create function pg_temp.nums(
  p_terms text[] default null, p_my text default null, p_partner text default null, p_format text default null,
  p_own text default null, p_series text default null, p_loan text default null, p_rating text default null,
  p_sort text default 'added', p_dir text default null, p_offset int default 0, p_limit int default 48,
  p_book_ids uuid[] default null, p_library uuid default '10000000-0000-0000-0000-0000000000f0'
) returns int[] language sql as $$
  select coalesce(array_agg(n order by ord), '{}'::int[]) from (
    select right(r.book_id::text, 12)::int as n, r.ord
    from public.library_page(p_library, p_terms, p_my, p_partner, p_format, p_own, p_series, p_loan, p_rating, p_sort, p_dir, p_offset, p_limit, p_book_ids)
         with ordinality as r(book_id, total, ord)
  ) s
$$;

-- ---------------------------------------------------------------- the generated columns
select is((select search_folded from public.books where id = '30000000-0000-0000-0000-000000000003'), 'eclair etudes zoe bronte ',
  'search_folded folds title and authors (accents and case)');
select is((select search_folded from public.books where id = '30000000-0000-0000-0000-000000000008'), 'returned book dickens, monica saga',
  'search_folded includes the series name');
select is((select sort_title collate "default" from public.books where id = '30000000-0000-0000-0000-000000000002'), 'Fellowship of the Ring', 'sort_title drops a leading "The "');
select is((select sort_title collate "default" from public.books where id = '30000000-0000-0000-0000-000000000007'), 'Anthology', 'sort_title drops a leading "An "');
select is((select sort_title collate "default" from public.books where id = '30000000-0000-0000-0000-000000000004'), 'Tale of Two Cities', 'sort_title drops a leading "A "');
select is((select sort_author collate "default" from public.books where id = '30000000-0000-0000-0000-000000000001'), 'Tolkien', 'sort_author is the text before a comma');
select is((select sort_author collate "default" from public.books where id = '30000000-0000-0000-0000-000000000002'), 'Tolkien', 'sort_author is the last word otherwise');
select ok((select sort_author is null from public.books where id = '30000000-0000-0000-0000-000000000007'), 'sort_author is null with no author');

-- ---------------------------------------------------------------- filters and sorts, as alice
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');

select is(pg_temp.nums(), array[13, 12, 10, 11, 9, 8, 7, 6, 5, 4, 3, 2, 1]::int[],
  'default sort is newest first, title then id on a tie');
select is(pg_temp.nums(p_sort => 'title'), array[13, 7, 5, 6, 9, 3, 2, 1, 8, 4, 10, 11, 12]::int[],
  'title ascending: articles ignored, numbers numeric, case ignored, id breaks the tie');
select is(pg_temp.nums(p_sort => 'title', p_dir => 'desc'), array[12, 10, 11, 4, 8, 1, 2, 3, 9, 6, 5, 7, 13]::int[],
  'title descending');
select is(pg_temp.nums(p_sort => 'author'), array[5, 6, 3, 8, 4, 9, 12, 13, 2, 1, 10, 11, 7]::int[],
  'author ascending: last name, comma form, missing author last');
select is(pg_temp.nums(p_sort => 'author', p_dir => 'desc'), array[7, 10, 11, 2, 1, 13, 12, 9, 8, 4, 3, 5, 6]::int[],
  'author descending puts a missing author first');
select is(pg_temp.nums(p_sort => 'series'), array[1, 2, 8, 5, 6, 10, 11, 13, 7, 9, 3, 4, 12]::int[],
  'series ascending: no series last, then position with nulls last');
select is(pg_temp.nums(p_sort => 'series', p_dir => 'desc'), array[6, 5, 8, 10, 11, 2, 1, 13, 7, 9, 3, 4, 12]::int[],
  'series descending keeps no series last');
select is(pg_temp.nums(p_sort => 'added', p_dir => 'asc'), array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]::int[],
  'date added ascending');
select is(pg_temp.nums(p_sort => 'myrating'), array[1, 11, 2, 8, 7, 9, 13, 5, 6, 3, 4, 10, 12]::int[],
  'my rating descending: unrated last');
select is(pg_temp.nums(p_sort => 'myrating', p_dir => 'asc'), array[9, 7, 8, 2, 1, 11, 13, 5, 6, 3, 4, 10, 12]::int[],
  'my rating ascending: unrated still last');
select is(pg_temp.nums(p_sort => 'rating'), array[12, 1, 2, 5, 6, 4, 9, 10, 11, 7, 13, 3, 8]::int[],
  'public rating descending: unrated last');
select is(pg_temp.nums(p_sort => 'rating', p_dir => 'asc'), array[7, 9, 10, 11, 4, 5, 6, 2, 1, 12, 13, 3, 8]::int[],
  'public rating ascending: unrated still last');
select is(pg_temp.nums(p_sort => 'price'), array[7, 1, 10, 12, 2, 4, 8, 13, 5, 6, 9, 3, 11]::int[],
  'price descending: sum of copies, none last');
select is(pg_temp.nums(p_sort => 'price', p_dir => 'asc'), array[8, 4, 2, 10, 12, 1, 7, 13, 5, 6, 9, 3, 11]::int[],
  'price ascending: none still last');
select is(pg_temp.nums(p_terms => array['eclair', 'etudes'], p_sort => 'title'), array[3]::int[],
  'search ignores accents and case');
select is(pg_temp.nums(p_terms => array['zoe'], p_sort => 'title'), array[3]::int[],
  'search finds an author with an accent');
select is(pg_temp.nums(p_terms => array['saga', 'alp'], p_sort => 'title'), array[5, 6]::int[],
  'search matches author and series, every term');
select is(pg_temp.nums(p_terms => array['tale', 'cities'], p_sort => 'title'), array[4]::int[],
  'search terms may sit in different words');
select is(pg_temp.nums(p_terms => array['hobbit', 'tolkien']), array[1]::int[],
  'search splits on any run of spaces');
select is(pg_temp.nums(p_terms => array['100%'], p_sort => 'title'), array[13]::int[],
  'search treats a percent sign literally');
select is(pg_temp.nums(p_terms => array['e_t']), array[]::int[],
  'search treats an underscore literally');
select is(pg_temp.nums(p_my => 'read', p_sort => 'title'), array[1, 8, 11]::int[],
  'my status read');
select is(pg_temp.nums(p_my => 'want', p_sort => 'title'), array[9, 3]::int[],
  'my status want');
select is(pg_temp.nums(p_my => 'none', p_sort => 'title'), array[13, 5, 6, 4, 10, 12]::int[],
  'my status none: no row at all');
select is(pg_temp.nums(p_partner => 'reading', p_sort => 'title'), array[2, 8]::int[],
  'partner reading');
select is(pg_temp.nums(p_partner => 'read', p_sort => 'title'), array[1]::int[],
  'partner read');
select is(pg_temp.nums(p_format => 'ebook', p_sort => 'title'), array[3, 1]::int[],
  'format ebook');
select is(pg_temp.nums(p_format => 'paperback', p_sort => 'title'), array[2, 4, 10, 12]::int[],
  'format paperback');
select is(pg_temp.nums(p_own => 'wishlist', p_sort => 'title'), array[5, 6]::int[],
  'ownership wishlist');
select is(pg_temp.nums(p_own => 'owned', p_sort => 'title'), array[13, 7, 3, 2, 1, 8, 4, 10, 11, 12]::int[],
  'ownership owned');
select is(pg_temp.nums(p_series => 'Saga', p_sort => 'series'), array[8, 5, 6, 10, 11]::int[],
  'series name');
select is(pg_temp.nums(p_loan => 'out', p_sort => 'title'), array[2, 4]::int[],
  'loan out: active lends only');
select is(pg_temp.nums(p_loan => 'overdue', p_sort => 'title'), array[9, 4]::int[],
  'loan overdue: active, due day passed, either direction');
select is(pg_temp.nums(p_loan => 'borrowed', p_sort => 'title'), array[9]::int[],
  'loan borrowed: ownership borrowed');
select is(pg_temp.nums(p_rating => '4', p_sort => 'title'), array[2, 1, 11]::int[],
  'rating at least 4');
select is(pg_temp.nums(p_rating => '3.5', p_sort => 'title'), array[2, 1, 8, 11]::int[],
  'rating at least 3.5');
select is(pg_temp.nums(p_rating => 'unrated', p_sort => 'title'), array[13, 5, 6, 3, 4, 10, 12]::int[],
  'rating unrated: null or no row');
select is(pg_temp.nums(p_my => 'read', p_own => 'owned', p_sort => 'title', p_dir => 'desc'), array[11, 8, 1]::int[],
  'filters combine');

-- ---------------------------------------------------------------- paging
select is(pg_temp.nums(p_sort => 'title', p_limit => 5), array[13, 7, 5, 6, 9]::int[], 'limit returns the first rows');
select is(pg_temp.nums(p_sort => 'title', p_limit => 5, p_offset => 5), array[3, 2, 1, 8, 4]::int[], 'offset starts after them');
select is(pg_temp.nums(p_sort => 'title', p_limit => 5, p_offset => 10), array[10, 11, 12]::int[], 'the last page is short');
select is(pg_temp.nums(p_sort => 'title', p_limit => 5, p_offset => 13), array[]::int[], 'an offset past the end is empty');
select is((select total from public.library_page('10000000-0000-0000-0000-0000000000f0', p_limit => 5) limit 1), 13::bigint, 'total counts every match, not the page');
select is((select total from public.library_page('10000000-0000-0000-0000-0000000000f0', p_terms => array['saga'], p_limit => 2, p_offset => 2) limit 1), 5::bigint, 'total follows the filters');
select is(pg_temp.nums(p_sort => 'rating', p_limit => 4) || pg_temp.nums(p_sort => 'rating', p_limit => 4, p_offset => 4) || pg_temp.nums(p_sort => 'rating', p_limit => 5, p_offset => 8),
  array[12, 1, 2, 5, 6, 4, 9, 10, 11, 7, 13, 3, 8]::int[], 'pages of a tied sort join into the full order with no gap or repeat');

-- ---------------------------------------------------------------- restricted to a set of books
select is(pg_temp.nums(p_sort => 'title', p_book_ids => array['30000000-0000-0000-0000-000000000012', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000007', '99999999-9999-9999-9999-999999999999']::uuid[]),
  array[7, 1, 12]::int[], 'p_book_ids limits the books considered (unknown ids are ignored)');
select is(pg_temp.nums(p_my => 'read', p_sort => 'title', p_book_ids => array['30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002']::uuid[]), array[1]::int[], 'p_book_ids combines with filters');

-- ---------------------------------------------------------------- series names
select is((select array_agg(s order by s) from public.library_series_names('10000000-0000-0000-0000-0000000000f0') s), array['Middle-earth', 'Saga']::text[], 'library_series_names lists each series once');

-- ---------------------------------------------------------------- "me" is whoever calls
select pg_temp.act_as('b0000000-0000-0000-0000-000000000002');
select is(pg_temp.nums(p_my => 'reading', p_sort => 'title'), array[2, 8]::int[], 'my status is the caller''s: bob');
select is(pg_temp.nums(p_partner => 'reading', p_sort => 'title'), array[2]::int[], 'partner status looks at everyone else: alice reads n2');
select is(pg_temp.nums(p_my => 'none', p_sort => 'title'), array[13, 7, 5, 6, 9, 3, 10, 11, 12]::int[], 'bob has no status on these');
select is(pg_temp.nums(p_rating => 'unrated', p_sort => 'title'), pg_temp.nums(p_sort => 'title'), 'bob has rated nothing');

select pg_temp.act_as('c0000000-0000-0000-0000-000000000003');
select is(array_length(pg_temp.nums(), 1), 13, 'a viewer sees the whole library');
select is(pg_temp.nums(p_my => 'none', p_sort => 'title'), pg_temp.nums(p_sort => 'title'), 'carol has no statuses at all');

-- ---------------------------------------------------------------- RLS: a non-member sees nothing
select pg_temp.act_as('e0000000-0000-0000-0000-000000000005');
select is(pg_temp.nums(), array[]::int[], 'a non-member gets no rows');
select is((select count(*) from public.library_page('10000000-0000-0000-0000-0000000000f0')), 0::bigint, 'a non-member gets no total either');
select is((select count(*) from public.library_series_names('10000000-0000-0000-0000-0000000000f0')), 0::bigint, 'a non-member sees no series names');
select pg_temp.act_as_admin();

-- ---------------------------------------------------------------- the overdue day rule and other edge rows (added as admin)
insert into public.books (id, library_id, title, subtitle, authors) values
  ('30000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-0000000000f0', 'Due Today', 'quokka', '{"Dee Dee"}'),
  ('30000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-0000000000f0', 'Due Yesterday', null, '{"Dee Dee"}'),
  ('30000000-0000-0000-0000-000000000016', '10000000-0000-0000-0000-0000000000f0', 'Theodore Rex', null, '{"Anne Of"}'),
  ('30000000-0000-0000-0000-000000000017', '10000000-0000-0000-0000-0000000000f0', 'Spaced  Author', null, '{"  Padded Name  "}');
insert into public.copies (id, book_id, format) values
  ('40000000-0000-0000-0000-000000001401', '30000000-0000-0000-0000-000000000014', 'paperback'),
  ('40000000-0000-0000-0000-000000001501', '30000000-0000-0000-0000-000000000015', 'paperback');
insert into public.loans (direction, copy_id, book_id, borrower_id, loaned_at, due_at) values
  ('out', '40000000-0000-0000-0000-000000001401', '30000000-0000-0000-0000-000000000014', '50000000-0000-0000-0000-000000000001', now() - interval '30 days', (now() at time zone 'utc')::date::timestamp at time zone 'utc'),
  ('out', '40000000-0000-0000-0000-000000001501', '30000000-0000-0000-0000-000000000015', '50000000-0000-0000-0000-000000000001', now() - interval '30 days', ((now() at time zone 'utc')::date - 1)::timestamp at time zone 'utc' + interval '23 hours 59 minutes');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
select is(pg_temp.nums(p_loan => 'overdue', p_sort => 'title'), array[9, 15, 4]::int[], 'overdue: due yesterday counts, due today does not');
select is(pg_temp.nums(p_loan => 'out', p_sort => 'title'), array[14, 15, 2, 4]::int[], 'both new lends are out');
select is(pg_temp.nums(p_terms => array['quokka']), array[]::int[], 'the subtitle is not searched');
select is((select sort_title collate "default" from public.books where id = '30000000-0000-0000-0000-000000000016'), 'Theodore Rex', 'sort_title only drops an article followed by a space');
select is((select sort_author collate "default" from public.books where id = '30000000-0000-0000-0000-000000000017'), 'Name', 'sort_author trims the author before taking the last word');

select * from finish();
rollback;
