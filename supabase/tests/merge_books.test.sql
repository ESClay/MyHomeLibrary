-- merge_books. Run with `npx supabase test db` against a local stack. All rolled back.
-- Fixtures: alice owns library 1, bob is an editor of it, carol a viewer; alice also owns library 2 (cross-library case).
begin;
select plan(25);

insert into auth.users (id, aud, role, email) values
  ('a0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'alice@example.com'),
  ('b0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'bob@example.com'),
  ('c0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'carol@example.com');
insert into public.libraries (id, name, owner_id) values
  ('10000000-0000-0000-0000-0000000000a1', 'Merge library', 'a0000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-0000000000a2', 'Other library', 'a0000000-0000-0000-0000-000000000001');
insert into public.library_members (library_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-000000000002', 'editor'),
  ('10000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-000000000003', 'viewer');

-- K = keeper, M1 and M2 = merged, X = in another library.
insert into public.books (id, library_id, title, authors, ownership, cover_url, description, isbn13, page_count, series_name, series_position, calibre_uuid) values
  ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000a1', 'Keeper', '{"Ann Author"}', 'wishlist', 'https://example.com/k.jpg', null, null, null, null, null, null),
  ('30000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000a1', 'Merged one', '{"Ann Author"}', 'owned', 'https://example.com/m1.jpg', 'From M1', '9780000000002', 320, 'Saga', 2, 'calibre-m1'),
  ('30000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-0000000000a1', 'Merged two', '{"Ann Author"}', 'wishlist', null, 'From M2', '9780000000019', 999, 'Other saga', 7, null),
  ('30000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000a2', 'Elsewhere', '{"Ann Author"}', 'owned', null, null, null, null, null, null);

insert into public.copies (id, book_id, format) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'paperback'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-0000000000b1', 'hardcover'),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-0000000000b2', 'ebook');

insert into public.reads (user_id, book_id, started_at, finished_at) values
  ('a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000b1', '2026-01-01', '2026-01-09');

-- user_books: alice has rows on K and M1 (conflict); bob only on M2 (moves); carol none.
insert into public.user_books (user_id, book_id, status, rating, notes) values
  ('a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 'reading', null, 'Keeper note'),
  ('a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000b1', 'read', 4.5, 'M1 note'),
  ('b0000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-0000000000b2', 'dnf', 2, null);

-- Shelves: S1 holds K (position 3000) and M1 (position 1000): keeper stays at 3000. S2 holds only M1 and M2 (2000, 500): keeper gets 500.
insert into public.shelves (id, library_id, name, color, created_by) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a1', 'Shelf one', '#888888', 'a0000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000a1', 'Shelf two', '#888888', 'a0000000-0000-0000-0000-000000000001');
insert into public.shelf_books (shelf_id, book_id, position) values
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 3000),
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000b1', 1000),
  ('50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-0000000000b1', 2000),
  ('50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-0000000000b2', 500);

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- Refusals first (nothing changes).
select pg_temp.act_as('c0000000-0000-0000-0000-000000000003');
select throws_ok($$select public.merge_books('30000000-0000-0000-0000-00000000000a', array['30000000-0000-0000-0000-0000000000b1']::uuid[])$$,
  '42501', 'Only owners and editors can merge books', 'a viewer is refused');

select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
select throws_ok($$select public.merge_books('30000000-0000-0000-0000-00000000000a', array['30000000-0000-0000-0000-0000000000c1']::uuid[])$$,
  'P0001', 'Books from different libraries cannot be merged', 'books of another library are refused');
select throws_ok($$select public.merge_books('30000000-0000-0000-0000-00000000000a', array['30000000-0000-0000-0000-00000000000a']::uuid[])$$,
  'P0001', 'The book to keep cannot also be merged away', 'the keeper cannot be in the merge list');
select throws_ok($$select public.merge_books('30000000-0000-0000-0000-00000000000a', array['30000000-0000-0000-0000-0000000000b1','30000000-0000-0000-0000-0000000000b1']::uuid[])$$,
  'P0001', 'Each book can be listed only once', 'duplicates are refused');
select throws_ok($$select public.merge_books('30000000-0000-0000-0000-00000000000a', '{}'::uuid[])$$,
  'P0001', 'Merge between 2 and 10 books', 'an empty list is refused');
select throws_ok($$select public.merge_books('30000000-0000-0000-0000-00000000000a', array['30000000-0000-0000-0000-0000000000b1']::uuid[], '30000000-0000-0000-0000-0000000000c1')$$,
  'P0001', 'The cover must come from one of the selected books', 'the cover must come from a selected book');
select is((select count(*)::int from public.books where library_id = '10000000-0000-0000-0000-0000000000a1'), 3, 'refusals changed nothing');

-- Loan conflict: two active "borrowed from" loans across the selection abort the merge.
reset role;
insert into public.borrowers (id, library_id, name) values ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a1', 'Lender');
update public.books set ownership = 'borrowed' where id in ('30000000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-0000000000b2');
insert into public.loans (id, direction, book_id, borrower_id) values
  ('70000000-0000-0000-0000-000000000001', 'in', '30000000-0000-0000-0000-0000000000b1', '60000000-0000-0000-0000-000000000001'),
  ('70000000-0000-0000-0000-000000000002', 'in', '30000000-0000-0000-0000-0000000000b2', '60000000-0000-0000-0000-000000000001');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
select throws_ok($$select public.merge_books('30000000-0000-0000-0000-00000000000a', array['30000000-0000-0000-0000-0000000000b1','30000000-0000-0000-0000-0000000000b2']::uuid[])$$,
  '23505', null, 'two active borrowed loans abort the merge with a clear message');
select is((select count(*)::int from public.books where id in ('30000000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-0000000000b2')), 2, 'and nothing was merged');

-- Return one loan, restore ownership, then merge for real (as the editor, bob).
reset role;
update public.loans set returned_at = now() where id = '70000000-0000-0000-0000-000000000002';
update public.books set ownership = 'owned' where id = '30000000-0000-0000-0000-0000000000b1';
update public.books set ownership = 'wishlist' where id = '30000000-0000-0000-0000-0000000000b2';
select pg_temp.act_as('b0000000-0000-0000-0000-000000000002');
select is(public.merge_books('30000000-0000-0000-0000-00000000000a',
  array['30000000-0000-0000-0000-0000000000b1','30000000-0000-0000-0000-0000000000b2']::uuid[],
  '30000000-0000-0000-0000-0000000000b1') ->> 'removed', '2', 'an editor merges two books');

reset role;
select is((select count(*)::int from public.books where id in ('30000000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-0000000000b2')), 0, 'merged books are gone');
select is((select count(*)::int from public.copies where book_id = '30000000-0000-0000-0000-00000000000a'), 3, 'all copies moved');
select is((select count(*)::int from public.reads where book_id = '30000000-0000-0000-0000-00000000000a'), 1, 'reads moved');
select is((select book_id from public.loans where id = '70000000-0000-0000-0000-000000000001'), '30000000-0000-0000-0000-00000000000a'::uuid, 'loans moved');

-- user_books conflict: alice keeps the keeper row, takes the most advanced status, fills the rating, joins the notes.
select is((select status::text || '/' || rating::text || '/' || replace(notes, E'\n', '|') from public.user_books
  where user_id = 'a0000000-0000-0000-0000-000000000001' and book_id = '30000000-0000-0000-0000-00000000000a'),
  'read/4.5/Keeper note||M1 note', 'user_books: best status, filled rating, notes joined by a blank line');
select is((select status::text || '/' || rating::text from public.user_books
  where user_id = 'b0000000-0000-0000-0000-000000000002' and book_id = '30000000-0000-0000-0000-00000000000a'),
  'dnf/2.0', 'a row that only the merged book had moves to the keeper (even though the caller is another person)');

-- Shelf conflict: the keeper keeps its own position where it was already on the shelf, takes the best one where not.
select is((select position from public.shelf_books where shelf_id = '50000000-0000-0000-0000-000000000001' and book_id = '30000000-0000-0000-0000-00000000000a'), 3000, 'shelf one: keeper keeps its position');
select is((select position from public.shelf_books where shelf_id = '50000000-0000-0000-0000-000000000002' and book_id = '30000000-0000-0000-0000-00000000000a'), 500, 'shelf two: keeper takes the lowest position');
select is((select count(*)::int from public.shelf_books where book_id in ('30000000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-0000000000b2')), 0, 'no merged shelf rows remain');

-- Book fields: fill empties in selection order, chosen cover, ownership, calibre uuid.
select is((select description || '/' || isbn13 || '/' || page_count::text from public.books where id = '30000000-0000-0000-0000-00000000000a'),
  'From M1/9780000000002/320', 'empty fields fill from the first merged book that has them');
select is((select series_name || '#' || series_position::text from public.books where id = '30000000-0000-0000-0000-00000000000a'),
  'Saga#2', 'the series name and number come from the same book');
select is((select cover_url from public.books where id = '30000000-0000-0000-0000-00000000000a'), 'https://example.com/m1.jpg', 'the chosen cover is used');
select is((select ownership::text from public.books where id = '30000000-0000-0000-0000-00000000000a'), 'owned', 'any owned book makes the keeper owned');
select is((select calibre_uuid from public.books where id = '30000000-0000-0000-0000-00000000000a'), 'calibre-m1', 'calibre_uuid moves to a keeper without one');
select is((select title from public.books where id = '30000000-0000-0000-0000-00000000000a'), 'Keeper', 'the keeper keeps its title');

select * from finish();
rollback;
