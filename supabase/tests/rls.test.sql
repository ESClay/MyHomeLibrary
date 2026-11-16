-- RLS test plan (pgTAP). Run with `npx supabase test db` against a local stack.
-- It can also run against a hosted project; it then must assume real data exists
-- (so counts only look at the fixture rows) and that hosted-only triggers are active
-- (e.g. storage.protect_delete(), so nothing deletes from storage tables directly).
-- Everything runs in one transaction that is rolled back.
-- Fixtures: alice (owner of Lib A), bob (editor of Lib A), carol (viewer of Lib A),
-- dave (owns Lib B; accepts an invite into Lib A mid-file),
-- eve (member of nothing, ever).
begin;
select plan(209);

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, aud, role, email) values
  ('a0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'alice@example.com'),
  ('b0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'bob@example.com'),
  ('c0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'carol@example.com'),
  ('d0000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'dave@example.com'),
  ('e0000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'eve@example.com');

insert into public.libraries (id, name, owner_id) values
  ('10000000-0000-0000-0000-00000000000a', 'Lib A', 'a0000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-00000000000b', 'Lib B', 'd0000000-0000-0000-0000-000000000004');

insert into public.library_members (library_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000002', 'editor'),
  ('10000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000003', 'viewer');

insert into public.books (id, library_id, title) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Book in A'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Book in B');

insert into public.user_books (user_id, book_id, status, rating, notes) values
  ('a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', 'read', 4.5, 'alice notes');

insert into public.library_invites (library_id, email, role, token) values
  ('10000000-0000-0000-0000-00000000000a', 'new@example.com', 'viewer', 'good-token'),
  ('10000000-0000-0000-0000-00000000000a', 'old@example.com', 'viewer', 'expired-token');
update public.library_invites set expires_at = now() - interval '1 day' where token = 'expired-token';

-- Helper: act as a given user for the rest of the transaction (until reset role).
create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- Helper: back to the admin role AND no signed-in user. `reset role` alone leaves request.jwt.claims
-- (set transaction-locally by act_as) in place, so auth.uid() would still return the last user.
create function pg_temp.act_as_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Helper: number of rows a DML statement affected (0 when RLS filters them all out).
create function pg_temp.affected(q text) returns int language plpgsql as $$
declare n int;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Phase 6b: the paid features need an entitlement, so the fixture people who use them below (alice, bob) are granted
-- up front, as the app admin would. The service role / a direct insert is the only way to write the table.
select pg_temp.act_as_admin();
insert into public.user_entitlements (user_id, full_access, granted_at) values
  ('a0000000-0000-0000-0000-000000000001', true, now()),
  ('b0000000-0000-0000-0000-000000000002', true, now());

-- --------------------------------------------------------- triggers / setup
select is(
  (select role::text from public.library_members
    where library_id = '10000000-0000-0000-0000-00000000000a'
      and user_id = 'a0000000-0000-0000-0000-000000000001'),
  'owner', 'creating a library adds the creator as owner');
select is((select count(*)::int from public.profiles where id in (
  'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
  'c0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000004',
  'e0000000-0000-0000-0000-000000000005')), 5, 'profiles are created on signup for all five fixture users');

-- ------------------------------------------------- non-member isolation (dave)
select pg_temp.act_as('d0000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.books where library_id = '10000000-0000-0000-0000-00000000000a'),
  0, 'non-member cannot read another library''s books');
select is((select count(*)::int from public.libraries where id = '10000000-0000-0000-0000-00000000000a'),
  0, 'non-member cannot see another library');
select is((select count(*)::int from public.user_books), 0, 'non-member cannot read user_books of other libraries');
select throws_ok(
  $$insert into public.books (library_id, title) values ('10000000-0000-0000-0000-00000000000a', 'Intruder')$$,
  '42501', null, 'non-member cannot insert books into another library');
select throws_ok(
  $$insert into public.user_books (user_id, book_id) values
    ('d0000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'non-member cannot create user_books for another library''s book');
select is((select count(*)::int from public.library_invites), 0, 'non-owner cannot read invites');
reset role;

-- ------------------------------------------------------- viewer cannot write (carol)
select pg_temp.act_as('c0000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.books), 1, 'viewer can read library books');
select throws_ok(
  $$insert into public.books (library_id, title) values ('10000000-0000-0000-0000-00000000000a', 'Nope')$$,
  '42501', null, 'viewer cannot insert books');
update public.books set title = 'Hacked' where id = '20000000-0000-0000-0000-00000000000a';
delete from public.books where id = '20000000-0000-0000-0000-00000000000a';
select throws_ok(
  $$insert into public.shelves (library_id, name) values ('10000000-0000-0000-0000-00000000000a', 'Nope')$$,
  '42501', null, 'viewer cannot create shelves');
select is((select count(*)::int from public.library_members), 3, 'viewer can list members');
select is(
  pg_temp.affected($$update public.library_members set role = 'owner'
                     where user_id = 'c0000000-0000-0000-0000-000000000003'$$),
  0, 'viewer cannot promote themselves');
reset role;
select is((select title from public.books where id = '20000000-0000-0000-0000-00000000000a'),
  'Book in A', 'viewer update/delete had no effect');

-- --------------------------------------- editor writes, but is not an owner (bob)
select pg_temp.act_as('b0000000-0000-0000-0000-000000000002');
select lives_ok(
  $$insert into public.books (library_id, title) values ('10000000-0000-0000-0000-00000000000a', 'By Bob')$$,
  'editor can insert books');
select is((select count(*)::int from public.library_invites), 0, 'editor cannot read invites');
select throws_ok(
  $$insert into public.library_invites (library_id, email, role) values
    ('10000000-0000-0000-0000-00000000000a', 'x@example.com', 'viewer')$$,
  '42501', null, 'editor cannot create invites');

-- ------------------------------------ user_books: read all, write only your own
select is((select notes from public.user_books where book_id = '20000000-0000-0000-0000-00000000000a'),
  'alice notes', 'members can read each other''s user_books');
select is(
  pg_temp.affected($$update public.user_books set rating = 1, notes = 'overwritten'
                     where user_id = 'a0000000-0000-0000-0000-000000000001'$$),
  0, 'member cannot edit another member''s user_books');
select throws_ok(
  $$insert into public.user_books (user_id, book_id) values
    ('a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'member cannot insert user_books on behalf of another member');
reset role;

-- ------------------------------------------------------------ accept_invite (dave)
select pg_temp.act_as('d0000000-0000-0000-0000-000000000004');
select throws_ok($$select public.accept_invite('expired-token')$$, 'P0001', 'Invite expired', 'expired invite is rejected');
select throws_ok($$select public.accept_invite('nope')$$, 'P0002', 'Invite not found', 'unknown token is rejected');
select is(public.accept_invite('good-token'), '10000000-0000-0000-0000-00000000000a'::uuid, 'valid invite returns the library id');
select is(public.library_role('10000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000004')::text,
  'viewer', 'accepting an invite creates the membership with the invited role');
select throws_ok($$select public.accept_invite('good-token')$$, 'P0001', 'Invite already used', 'invite cannot be reused');
reset role;


-- ------------------------------------------------------------ reads (phase 2)
reset role;
insert into public.reads (user_id, book_id, started_at, finished_at) values
  ('a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a', '2026-01-01', '2026-01-10');

select pg_temp.act_as('c0000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.reads where book_id = '20000000-0000-0000-0000-00000000000a'),
  1, 'members can read each other''s reads');
select is(pg_temp.affected($$update public.reads set finished_at = '2026-02-01'$$),
  0, 'member cannot edit another member''s reads');
select is(pg_temp.affected($$delete from public.reads$$), 0, 'member cannot delete another member''s reads');
select throws_ok(
  $$insert into public.reads (user_id, book_id) values
    ('a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'member cannot insert a read for another member');
select lives_ok(
  $$insert into public.reads (user_id, book_id, started_at) values
    ('c0000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000a', '2026-03-01')$$,
  'member can add their own read (viewers keep personal data)');
select throws_ok(
  $$insert into public.reads (user_id, book_id) values
    ('c0000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000b')$$,
  '42501', null, 'cannot add a read to a book in a library you are not in');
select throws_ok(
  $$insert into public.reads (user_id, book_id, started_at, finished_at) values
    ('c0000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000a', '2026-05-02', '2026-05-01')$$,
  '23514', null, 'finish date cannot precede start date');
select throws_ok(
  $$insert into public.user_books (user_id, book_id, rating) values
    ('c0000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-00000000000a', 4.3)$$,
  '23514', null, 'ratings must be in half-star steps');
reset role;

select pg_temp.act_as('e0000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.reads), 0, 'non-members cannot read reads of other libraries');
reset role;

-- ------------------------------------------------- covers bucket (phase 2)
select pg_temp.act_as('b0000000-0000-0000-0000-000000000002');
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
    ('covers', '10000000-0000-0000-0000-00000000000a/cover.jpg', 'b0000000-0000-0000-0000-000000000002')$$,
  'editor can upload a cover under their library prefix');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
    ('covers', '10000000-0000-0000-0000-00000000000b/cover.jpg', 'b0000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'editor cannot upload under another library''s prefix');
reset role;

select pg_temp.act_as('c0000000-0000-0000-0000-000000000003');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
    ('covers', '10000000-0000-0000-0000-00000000000a/viewer.jpg', 'c0000000-0000-0000-0000-000000000003')$$,
  '42501', null, 'viewer cannot upload covers');
select is(public.can_edit_cover_path('10000000-0000-0000-0000-00000000000a/x.jpg', 'c0000000-0000-0000-0000-000000000003'),
  false, 'viewer cannot edit (so not delete) covers in their library');
reset role;

-- Direct deletes from storage tables are blocked on hosted Supabase (storage.protect_delete()),
-- so the delete policy is verified through its catalog entry and its helper function.
select ok(exists (
  select 1 from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and policyname = 'covers_delete'
    and cmd = 'DELETE' and qual like '%can_edit_cover_path%'),
  'covers delete policy exists and is gated by can_edit_cover_path');

select pg_temp.act_as('b0000000-0000-0000-0000-000000000002');
select is(public.can_edit_cover_path('10000000-0000-0000-0000-00000000000a/x.jpg', 'b0000000-0000-0000-0000-000000000002'),
  true, 'editor can edit (so delete) covers in their library');
reset role;

-- ------------------------------------------------- scans bucket + scan_jobs (phase 3b)
-- As with covers, objects are never deleted from storage tables here (hosted Supabase blocks it);
-- the delete policy is checked through pg_policies and the path helper instead.
select pg_temp.act_as('b0000000-0000-0000-0000-000000000002');
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
    ('scans', '10000000-0000-0000-0000-00000000000a/b0000000-0000-0000-0000-000000000002/photo.jpg', 'b0000000-0000-0000-0000-000000000002')$$,
  'member can upload a scan under <library>/<own id>/');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
    ('scans', '10000000-0000-0000-0000-00000000000a/a0000000-0000-0000-0000-000000000001/photo.jpg', 'b0000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'member cannot upload into another user''s scan folder');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
    ('scans', '10000000-0000-0000-0000-00000000000b/b0000000-0000-0000-0000-000000000002/photo.jpg', 'b0000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'member cannot upload a scan under a library they do not belong to');
select is((select count(*)::int from storage.objects
  where bucket_id = 'scans' and name = '10000000-0000-0000-0000-00000000000a/b0000000-0000-0000-0000-000000000002/photo.jpg'),
  1, 'the owner can read their scan');
select is(public.owns_scan_path('10000000-0000-0000-0000-00000000000a/b0000000-0000-0000-0000-000000000002/x.jpg', 'b0000000-0000-0000-0000-000000000002'), true, 'own path under own library is accepted');
select is(public.owns_scan_path('10000000-0000-0000-0000-00000000000a/a0000000-0000-0000-0000-000000000001/x.jpg', 'b0000000-0000-0000-0000-000000000002'), false, 'another user''s folder is refused');
select is(public.owns_scan_path('not-a-uuid/b0000000-0000-0000-0000-000000000002/x.jpg', 'b0000000-0000-0000-0000-000000000002'), false, 'a path that does not start with a library id is refused');
reset role;

select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
select is((select count(*)::int from storage.objects
  where bucket_id = 'scans' and name = '10000000-0000-0000-0000-00000000000a/b0000000-0000-0000-0000-000000000002/photo.jpg'),
  0, 'another member of the library cannot read someone else''s scan');
reset role;

select pg_temp.act_as('e0000000-0000-0000-0000-000000000005');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values
    ('scans', '10000000-0000-0000-0000-00000000000a/e0000000-0000-0000-0000-000000000005/photo.jpg', 'e0000000-0000-0000-0000-000000000005')$$,
  '42501', null, 'a non-member cannot upload a scan');
reset role;

select ok(exists (
  select 1 from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and policyname = 'scans_delete'
    and cmd = 'DELETE' and qual like '%owns_scan_path%'),
  'scans delete policy exists and is gated by owns_scan_path');
select is((select count(*)::int from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and policyname like 'scans\_%' and cmd in ('UPDATE', 'ALL')),
  0, 'scans has no update policy: a photo is written once');
select ok((select not public and file_size_limit = 10485760 from storage.buckets where id = 'scans'),
  'scans bucket is private with a 10 MB limit');

select pg_temp.act_as('b0000000-0000-0000-0000-000000000002');
select lives_ok(
  $$insert into public.scan_jobs (library_id, photo_path) values
    ('10000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a/b0000000-0000-0000-0000-000000000002/photo.jpg')$$,
  'editor can create their own scan job');
select throws_ok(
  $$insert into public.scan_jobs (user_id, library_id, photo_path) values
    ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a/a0000000-0000-0000-0000-000000000001/photo.jpg')$$,
  '42501', null, 'cannot create a scan job for someone else');
select throws_ok(
  $$insert into public.scan_jobs (library_id, photo_path) values ('10000000-0000-0000-0000-00000000000a', 'somewhere/else.jpg')$$,
  '23514', null, 'scan job photo path must sit under <library>/<user>/');
reset role;

select pg_temp.act_as('c0000000-0000-0000-0000-000000000003');
select throws_ok(
  $$insert into public.scan_jobs (library_id, photo_path) values
    ('10000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a/c0000000-0000-0000-0000-000000000003/photo.jpg')$$,
  '42501', null, 'viewer cannot create a scan job');
reset role;

select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.scan_jobs where photo_path = '10000000-0000-0000-0000-00000000000a/b0000000-0000-0000-0000-000000000002/photo.jpg'),
  0, 'scan jobs are private to the user who made them');
reset role;

-- ------------------------------------------------ Phase 3c: Calibre import
-- books.calibre_uuid is unique per library (and only when set).
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
select lives_ok(
  $$insert into public.books (library_id, title, calibre_uuid) values
    ('10000000-0000-0000-0000-00000000000a', 'Imported once', 'cal-uuid-fixture-1')$$,
  'an editor can save a book with a calibre_uuid');
select throws_ok(
  $$insert into public.books (library_id, title, calibre_uuid) values
    ('10000000-0000-0000-0000-00000000000a', 'Imported twice', 'cal-uuid-fixture-1')$$,
  '23505', null, 'the same calibre_uuid cannot be saved twice in one library');
select lives_ok(
  $$insert into public.books (library_id, title) values
    ('10000000-0000-0000-0000-00000000000a', 'No uuid one'), ('10000000-0000-0000-0000-00000000000a', 'No uuid two')$$,
  'books without a calibre_uuid never collide');
reset role;
select lives_ok(
  $$insert into public.books (library_id, title, calibre_uuid) values
    ('10000000-0000-0000-0000-00000000000b', 'Same uuid, other library', 'cal-uuid-fixture-1')$$,
  'the same calibre_uuid is allowed in a different library');

-- import_jobs: owner-only, created only where the user can edit.
select pg_temp.act_as('b0000000-0000-0000-0000-000000000002');
select lives_ok(
  $$insert into public.import_jobs (id, library_id, total, rows) values
    ('f0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 0, '[]')$$,
  'an editor can create their own import job');
select throws_ok(
  $$insert into public.import_jobs (user_id, library_id) values
    ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'cannot create an import job for someone else');
select is(public.import_append_rows('f0000000-0000-0000-0000-000000000001', '[{"n":1},{"n":2}]'::jsonb), 2,
  'append adds rows to a pending job and returns the new total');
select is(jsonb_array_length(public.import_rows_slice('f0000000-0000-0000-0000-000000000001', 1, 10)), 1,
  'a slice returns the rows from the offset on');
reset role;

select pg_temp.act_as('c0000000-0000-0000-0000-000000000003');
select throws_ok(
  $$insert into public.import_jobs (library_id) values ('10000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'a viewer cannot create an import job');
reset role;

select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.import_jobs where id = 'f0000000-0000-0000-0000-000000000001'),
  0, 'import jobs are private to the user who made them');
select is(public.import_append_rows('f0000000-0000-0000-0000-000000000001', '[{"n":3}]'::jsonb), null::int,
  'another member cannot append rows to someone else''s job');
reset role;

select pg_temp.act_as('e0000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.import_jobs where id = 'f0000000-0000-0000-0000-000000000001'),
  0, 'a non-member cannot see an import job');
reset role;

-- ------------------------------------------------------------------ shelves
-- Fixture ids: s...01 legacy shelf (no created_by), 02 bob shared, 03 carol private, 04 bob private,
-- 05 bob smart, 06 carol private for the viewer-can-create check.
insert into public.books (id, library_id, title) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Shelf book 1'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'Shelf book 2');

-- Backfill: a shelf written without a creator belongs to the library owner.
-- Admin insert with no signed-in user (as the service role would be), so clear any leftover claims.
select pg_temp.act_as_admin();
insert into public.shelves (id, library_id, name) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'Legacy shelf');
select is(
  (select created_by from public.shelves where id = '50000000-0000-0000-0000-000000000001'),
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'a shelf with no creator is filled in with the library owner');
select is(
  (select color from public.shelves where id = '50000000-0000-0000-0000-000000000001'),
  'spine-1', 'a shelf defaults to the first spine colour');

select pg_temp.act_as('b0000000-0000-0000-0000-000000000002');
select lives_ok(
  $$insert into public.shelves (id, library_id, name, color) values
    ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a', 'Bob shared', 'spine-2')$$,
  'an editor can create a shared shelf');
select lives_ok(
  $$insert into public.shelves (id, library_id, name, visibility) values
    ('50000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-00000000000a', 'Bob private', 'private')$$,
  'an editor can create a private shelf');
select lives_ok(
  $$insert into public.shelves (id, library_id, name, kind, rules, sort) values
    ('50000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-00000000000a', 'Bob smart', 'smart', '{"my":"read"}', 'title')$$,
  'an editor can create a smart shelf');
select lives_ok(
  $$insert into public.shelf_books (shelf_id, book_id) values
    ('50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-0000000000a1'),
    ('50000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-0000000000a1')$$,
  'an editor can put a book on shared and own private shelves');
select throws_ok(
  $$insert into public.shelf_books (shelf_id, book_id) values
    ('50000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-0000000000a1')$$,
  '23514', null, 'a smart shelf cannot hold books');
select throws_ok(
  $$insert into public.shelf_books (shelf_id, book_id) values
    ('50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-00000000000b')$$,
  '23514', null, 'a shelf cannot hold a book from another library');
select throws_ok(
  $$update public.shelves set kind = 'smart', rules = '{}' where id = '50000000-0000-0000-0000-000000000002'$$,
  '23514', null, 'a shelf cannot change kind');
select throws_ok(
  $$insert into public.shelves (library_id, name, kind, rules, sort) values ('10000000-0000-0000-0000-00000000000a', 'Bad', 'smart', '{}', 'custom')$$,
  '23514', null, 'a smart shelf cannot use custom order');
select throws_ok(
  $$insert into public.shelves (library_id, name, rules) values ('10000000-0000-0000-0000-00000000000a', 'Bad', '{}')$$,
  '23514', null, 'a manual shelf cannot carry rules');
select throws_ok(
  $$insert into public.shelves (library_id, name, color) values ('10000000-0000-0000-0000-00000000000a', 'Bad', 'purple')$$,
  '23514', null, 'a shelf colour must be a spine colour');
select throws_ok(
  $$insert into public.shelves (library_id, name, created_by) values
    ('10000000-0000-0000-0000-00000000000a', 'Spoof', 'a0000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'a shelf cannot be created in someone else''s name');
reset role;

select pg_temp.act_as('c0000000-0000-0000-0000-000000000003');
select lives_ok(
  $$insert into public.shelves (id, library_id, name, visibility) values
    ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000a', 'Carol private', 'private')$$,
  'a viewer can create a private shelf');
select throws_ok(
  $$insert into public.shelves (library_id, name) values ('10000000-0000-0000-0000-00000000000a', 'Carol shared')$$,
  '42501', null, 'a viewer cannot create a shared shelf');
select lives_ok(
  $$insert into public.shelf_books (shelf_id, book_id) values
    ('50000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-0000000000a2')$$,
  'a viewer can put a book on their own private shelf');
select throws_ok(
  $$insert into public.shelf_books (shelf_id, book_id) values
    ('50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-0000000000a2')$$,
  '42501', null, 'a viewer cannot put a book on a shared shelf');
select is(
  pg_temp.affected($$update public.shelves set name = 'Hacked' where id = '50000000-0000-0000-0000-000000000002'$$),
  0, 'a viewer cannot rename a shared shelf');
select is(
  (select count(*)::int from public.shelves where id::text like '50000000-%'),
  4, 'a viewer sees the shared shelves and their own private one, not an editor''s');
select is(
  (select count(*)::int from public.shelf_books where shelf_id = '50000000-0000-0000-0000-000000000004'),
  0, 'a viewer cannot see the books on someone else''s private shelf');
reset role;

select pg_temp.act_as('b0000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.shelves where id = '50000000-0000-0000-0000-000000000003'),
  0, 'a private shelf is invisible to other members');
select is(
  (select count(*)::int from public.shelf_books where shelf_id = '50000000-0000-0000-0000-000000000003'),
  0, 'the books on a private shelf are invisible to other members');
select is(
  pg_temp.affected($$update public.shelves set name = 'Hacked' where id = '50000000-0000-0000-0000-000000000003'$$),
  0, 'an editor cannot edit someone else''s private shelf');
select is(
  pg_temp.affected($$delete from public.shelves where id = '50000000-0000-0000-0000-000000000003'$$),
  0, 'an editor cannot delete someone else''s private shelf');
select is(
  pg_temp.affected($$delete from public.shelf_books where shelf_id = '50000000-0000-0000-0000-000000000003'$$),
  0, 'an editor cannot remove books from someone else''s private shelf');
reset role;

select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.shelves where id::text like '50000000-%'),
  3, 'the owner sees shared and smart shelves but no one''s private shelf');
select is(
  pg_temp.affected($$delete from public.shelves where id = '50000000-0000-0000-0000-000000000004'$$),
  0, 'the owner cannot delete a member''s private shelf');
select is(
  pg_temp.affected($$update public.shelves set name = 'Renamed' where id = '50000000-0000-0000-0000-000000000002'$$),
  1, 'the owner can edit a shared shelf made by an editor');
reset role;

select pg_temp.act_as('e0000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.shelves where id::text like '50000000-%'), 0,
  'a non-member sees no shelves');
select throws_ok(
  $$insert into public.shelves (library_id, name, visibility) values ('10000000-0000-0000-0000-00000000000a', 'Eve', 'private')$$,
  '42501', null, 'a non-member cannot create a private shelf');
reset role;

-- ------------------------------------------------------------------- Discover (phase 5)
-- Fixtures: a shared set and alice's and bob's personal sets in Lib A, alice's feedback and a cron_runs row.
select pg_temp.act_as_admin();
insert into public.recommendation_sets (id, user_id, library_id, scope) values
  ('60000000-0000-0000-0000-000000000001', null, '10000000-0000-0000-0000-00000000000a', 'shared'),
  ('60000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'personal'),
  ('60000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a', 'personal');
insert into public.recommendation_feedback (user_id, work_key, feedback, title) values
  ('a0000000-0000-0000-0000-000000000001', 'fixture work|key', 'not_interested', 'Fixture');
insert into public.cron_runs (task, last_status) values ('fixture-task', 'complete');

select throws_ok(
  $$insert into public.recommendation_sets (user_id, library_id, scope) values
    ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'shared')$$,
  '23514', null, 'a shared set cannot belong to one person');
select throws_ok(
  $$insert into public.recommendation_sets (user_id, library_id, scope) values
    (null, '10000000-0000-0000-0000-00000000000a', 'personal')$$,
  '23514', null, 'a personal set must belong to someone');

select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.recommendation_sets where id = '60000000-0000-0000-0000-000000000001'),
  1, 'the owner sees the library''s shared set');
select is((select count(*)::int from public.recommendation_sets where id = '60000000-0000-0000-0000-000000000002'),
  1, 'the owner sees their own personal set');
select is((select count(*)::int from public.recommendation_sets where id = '60000000-0000-0000-0000-000000000003'),
  0, 'the owner does not see another member''s personal set');
select is((select count(*)::int from public.cron_runs where task = 'fixture-task'),
  0, 'a signed-in user sees no cron_runs rows');
select throws_ok(
  $$insert into public.cron_runs (task) values ('alice-task')$$,
  '42501', null, 'a signed-in user cannot write cron_runs');
select throws_ok(
  $$insert into public.series_entries (series_id, title) values (gen_random_uuid(), 'Forged entry')$$,
  '42501', null, 'a signed-in user cannot write series_entries');
select throws_ok(
  $$insert into public.series (name) values ('Forged series')$$,
  '42501', null, 'a signed-in user cannot write series');
reset role;

select pg_temp.act_as('b0000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.recommendation_sets where id = '60000000-0000-0000-0000-000000000001'),
  1, 'an editor sees the shared set');
select is((select count(*)::int from public.recommendation_sets where id = '60000000-0000-0000-0000-000000000002'),
  0, 'a member cannot see another member''s personal set');
select is((select count(*)::int from public.recommendation_feedback where work_key = 'fixture work|key'),
  0, 'a member cannot read another member''s feedback');
select throws_ok(
  $$insert into public.recommendation_feedback (user_id, work_key, feedback) values
    ('a0000000-0000-0000-0000-000000000001', 'forged|key', 'not_interested')$$,
  '42501', null, 'a member cannot write feedback as another member');
select lives_ok(
  $$insert into public.recommendation_feedback (user_id, work_key, feedback, title) values
    ('b0000000-0000-0000-0000-000000000002', 'bob work|key', 'already_read', 'Bob''s pick')$$,
  'a member can write their own feedback, including on a shared pick');
select throws_ok(
  $$insert into public.recommendation_sets (user_id, library_id, scope) values
    ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'personal')$$,
  '42501', null, 'a member cannot create a personal set for someone else');
select lives_ok(
  $$insert into public.recommendation_sets (id, user_id, library_id, scope, requested_by) values
    ('60000000-0000-0000-0000-000000000004', null, '10000000-0000-0000-0000-00000000000a', 'shared',
     'b0000000-0000-0000-0000-000000000002')$$,
  'a member can store a shared set for their library');
select throws_ok(
  $$insert into public.recommendation_sets (user_id, library_id, scope, requested_by) values
    (null, '10000000-0000-0000-0000-00000000000a', 'shared', 'a0000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'a shared set cannot be stored in someone else''s name');
select is(
  pg_temp.affected($$update public.recommendation_sets set error = 'x' where id = '60000000-0000-0000-0000-000000000001'$$),
  0, 'nobody can edit a stored set');
select is(
  pg_temp.affected($$delete from public.recommendation_sets where id = '60000000-0000-0000-0000-000000000002'$$),
  0, 'a member cannot delete another member''s personal set');
reset role;

-- Dave accepted an invite into Lib A earlier, so he is no outsider here. Frank owns Lib C and never joins Lib A.
select pg_temp.act_as_admin();
insert into auth.users (id, aud, role, email) values
  ('f1000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'frank@example.com');
insert into public.libraries (id, name, owner_id) values
  ('10000000-0000-0000-0000-00000000000c', 'Lib C', 'f1000000-0000-0000-0000-000000000006');

select pg_temp.act_as('f1000000-0000-0000-0000-000000000006');
select is((select count(*)::int from public.recommendation_sets where library_id = '10000000-0000-0000-0000-00000000000a'),
  0, 'a member of another library sees none of Lib A''s sets');
reset role;

select pg_temp.act_as('e0000000-0000-0000-0000-000000000005');
select throws_ok(
  $$insert into public.recommendation_sets (user_id, library_id, scope, requested_by) values
    (null, '10000000-0000-0000-0000-00000000000a', 'shared', 'e0000000-0000-0000-0000-000000000005')$$,
  '42501', null, 'a non-member cannot store a shared set in another library');
reset role;

select pg_temp.act_as('e0000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.recommendation_sets where id::text like '60000000-%'),
  0, 'a non-member sees no recommendation sets');
reset role;

-- ======================================================================= Phase 6
-- Region/locale, prices, borrowers and loans, stats functions. Admin statements run with no signed-in user
-- (pg_temp.act_as_admin), and dave is a viewer of Lib A by now, so eve and frank are the outsiders here.
-- New fixtures: gina (signs up with a region), hank (signs up with junk metadata), a borrowed book, three copies,
-- a borrower in each of Lib A and Lib B.
select pg_temp.act_as_admin();
insert into auth.users (id, aud, role, email, raw_user_meta_data) values
  ('a6000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'gina@example.com',
   '{"region": "EBAY_CA", "locale": "en-CA"}'),
  ('a6000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'hank@example.com',
   '{"region": "canada", "locale": "not a locale!"}');

select is((select region || '/' || locale from public.profiles where id = 'a6000000-0000-0000-0000-000000000007'),
  'EBAY_CA/en-CA', 'sign-up metadata sets the profile region and locale');
select is((select region from public.profiles where id = 'a6000000-0000-0000-0000-000000000008'),
  null, 'malformed region metadata is ignored instead of failing sign-up');
select is((select locale from public.profiles where id = 'a6000000-0000-0000-0000-000000000008'),
  null, 'malformed locale metadata is ignored');

insert into public.libraries (id, name, owner_id) values
  ('10000000-0000-0000-0000-0000000000d1', 'Lib Gina', 'a6000000-0000-0000-0000-000000000007'),
  ('10000000-0000-0000-0000-0000000000d2', 'Lib Hank', 'a6000000-0000-0000-0000-000000000008');
select is((select price_region from public.libraries where id = '10000000-0000-0000-0000-0000000000d1'),
  'EBAY_CA', 'a new library prices in its creator''s region');
select is((select price_region from public.libraries where id = '10000000-0000-0000-0000-0000000000d2'),
  null, 'a library whose owner has no region starts with prices off');

-- Fixtures in Lib A / Lib B for loans and prices.
insert into public.books (id, library_id, title, ownership, isbn13) values
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'Borrowed in A', 'borrowed', null),
  ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a', 'Owned with copies', 'owned', null);
insert into public.copies (id, book_id, format, edition_isbn, purchase_price, current_price, current_price_currency) values
  ('71000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', 'paperback', '9780441172719', 8.00, 10.00, 'CAD'),
  ('71000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', 'hardcover', null, 20.00, null, null),
  ('71000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000002', 'ebook', '9780441172719', 5.00, null, null);
insert into public.borrowers (id, library_id, name) values
  ('72000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'Sam'),
  ('72000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'Lib B friend');

-- profiles.region: each person updates only their own
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
select is(pg_temp.affected($$update public.profiles set region = 'EBAY_GB', locale = 'en-GB'
                             where id = 'a0000000-0000-0000-0000-000000000001'$$),
  1, 'a person can set their own region');
select is(pg_temp.affected($$update public.profiles set region = 'EBAY_US'
                             where id = 'b0000000-0000-0000-0000-000000000002'$$),
  0, 'a person cannot change someone else''s region');
select throws_ok($$update public.profiles set region = 'canada' where id = 'a0000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'a region must look like a marketplace id');
select lives_ok($$insert into public.price_check_log (user_id) values ('a0000000-0000-0000-0000-000000000001')$$,
  'a person can log their own price check');
select throws_ok($$insert into public.price_check_log (user_id) values ('b0000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'a person cannot log a price check as someone else');
reset role;
select is((select region from public.profiles where id = 'b0000000-0000-0000-0000-000000000002'),
  null, 'bob''s region was not touched by alice');

-- Lending as an editor (bob)
select pg_temp.act_as('b0000000-0000-0000-0000-000000000002');
select lives_ok($$insert into public.loans (direction, copy_id, borrower_id, due_at) values
  ('out', '71000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', now() + interval '14 days')$$,
  'an editor can lend a copy');
select is((select library_id from public.loans where copy_id = '71000000-0000-0000-0000-000000000001'),
  '10000000-0000-0000-0000-00000000000a'::uuid, 'the loan''s library is derived from its copy');
select is((select book_id from public.loans where copy_id = '71000000-0000-0000-0000-000000000001'),
  '70000000-0000-0000-0000-000000000002'::uuid, 'the loan''s book is derived from its copy');
select throws_ok($$insert into public.loans (direction, copy_id, borrower_id) values
  ('out', '71000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001')$$,
  '23505', null, 'a copy can have only one active loan out');
select throws_ok($$insert into public.loans (direction, copy_id, borrower_id) values
  ('out', '71000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-00000000000b')$$,
  '23514', null, 'a loan cannot use a borrower from another library');
select throws_ok($$insert into public.loans (direction, borrower_id) values
  ('out', '72000000-0000-0000-0000-000000000001')$$,
  '23514', null, 'a loan out needs a copy');
select lives_ok($$insert into public.borrowers (library_id, name) values ('10000000-0000-0000-0000-00000000000a', 'Kim')$$,
  'an editor can add a borrower');
select throws_ok($$insert into public.borrowers (library_id, name) values ('10000000-0000-0000-0000-00000000000a', ' sam ')$$,
  '23505', null, 'a borrower name is unique within a library, ignoring case and spaces');

-- an in-loan needs a borrowed book
select throws_ok($$insert into public.loans (direction, book_id, borrower_id) values
  ('in', '70000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000001')$$,
  '23514', null, 'a loan in needs a book marked borrowed');
select lives_ok($$insert into public.loans (direction, book_id, borrower_id, due_at) values
  ('in', '70000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', now() + interval '30 days')$$,
  'a borrowed book can have a loan in');
select throws_ok($$insert into public.loans (direction, book_id, borrower_id) values
  ('in', '70000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001')$$,
  '23505', null, 'a book can be borrowed from only one person at a time');
reset role;

-- A viewer reads but cannot lend (carol)
select pg_temp.act_as('c0000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.loans where library_id = '10000000-0000-0000-0000-00000000000a'),
  2, 'a viewer can read the library''s loans');
select is((select count(*)::int from public.borrowers where library_id = '10000000-0000-0000-0000-00000000000a'),
  2, 'a viewer can read the borrowers');
select throws_ok($$insert into public.loans (direction, copy_id, borrower_id) values
  ('out', '71000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'a viewer cannot lend a copy');
select throws_ok($$insert into public.borrowers (library_id, name) values ('10000000-0000-0000-0000-00000000000a', 'Viewer pal')$$,
  '42501', null, 'a viewer cannot add a borrower');
select is(pg_temp.affected($$update public.loans set returned_at = now() where copy_id = '71000000-0000-0000-0000-000000000001'$$),
  0, 'a viewer cannot mark a loan returned');
reset role;

-- Outsiders see and write nothing (eve is in no library; frank owns only Lib C)
select pg_temp.act_as('e0000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.loans where library_id = '10000000-0000-0000-0000-00000000000a'),
  0, 'a non-member sees no loans');
select is((select count(*)::int from public.borrowers where library_id = '10000000-0000-0000-0000-00000000000a'),
  0, 'a non-member sees no borrowers');
select throws_ok($$insert into public.loans (direction, copy_id, borrower_id) values
  ('out', '71000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'a non-member cannot lend another library''s copy');
reset role;

select pg_temp.act_as('f1000000-0000-0000-0000-000000000006');
select is((select count(*)::int from public.loans where library_id = '10000000-0000-0000-0000-00000000000a'),
  0, 'a member of another library sees none of Lib A''s loans');
select throws_ok($$insert into public.loans (direction, copy_id, borrower_id) values
  ('out', '71000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'a member of another library cannot lend Lib A''s copy');
reset role;

-- Dave is a viewer of Lib A and owns Lib B: he cannot lend Lib A's copy with his own library's borrower either
select pg_temp.act_as('d0000000-0000-0000-0000-000000000004');
select throws_ok($$insert into public.loans (direction, copy_id, borrower_id) values
  ('out', '71000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-00000000000b')$$,
  '23514', null, 'a loan cannot cross libraries even for someone in both');
reset role;

-- Returning frees the copy for another loan
select pg_temp.act_as('b0000000-0000-0000-0000-000000000002');
select is(pg_temp.affected($$update public.loans set returned_at = now() where copy_id = '71000000-0000-0000-0000-000000000001'$$),
  1, 'an editor can mark a loan returned');
select lives_ok($$insert into public.loans (direction, copy_id, borrower_id) values
  ('out', '71000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001')$$,
  'a returned copy can be lent again');
reset role;

-- Stats functions run as the caller, so row-level security applies
select pg_temp.act_as('b0000000-0000-0000-0000-000000000002');
select is((select copies from public.stats_value('10000000-0000-0000-0000-00000000000a', 'CAD')),
  2::bigint, 'stats_value counts the physical owned copies a member can see (the ebook is left out)');
select is((select est_value from public.stats_value('10000000-0000-0000-0000-00000000000a', 'CAD')),
  10.00::numeric, 'stats_value totals only prices in the asked currency');
select is((select unpriced from public.stats_value('10000000-0000-0000-0000-00000000000a', 'CAD')),
  1::bigint, 'stats_value counts copies with no price yet');
select is((select other_currency from public.stats_value('10000000-0000-0000-0000-00000000000a', 'USD')),
  1::bigint, 'a price in another currency is counted as such, not summed');
select is((select count(*)::int from public.stats_top_copies('10000000-0000-0000-0000-00000000000a', 'CAD')),
  1, 'stats_top_copies lists the priced copy');
reset role;

select pg_temp.act_as('e0000000-0000-0000-0000-000000000005');
select is((select copies from public.stats_value('10000000-0000-0000-0000-00000000000a', 'CAD')),
  0::bigint, 'a non-member gets nothing from stats_value for another library');
select is((select count(*)::int from public.stats_top_copies('10000000-0000-0000-0000-00000000000a', 'CAD')),
  0, 'a non-member gets nothing from stats_top_copies');
select is((select count(*)::int from public.stats_added('10000000-0000-0000-0000-00000000000a')),
  0, 'a non-member gets nothing from stats_added');
select throws_ok($$select * from public.price_refresh_candidates(now(), 10)$$,
  '42501', null, 'signed-in users cannot call the cron candidate query');
reset role;

-- The cron candidate query: physical, with an ISBN, in a library with a price region, never or long ago checked
select pg_temp.act_as_admin();
select is((select count(*)::int from public.price_refresh_candidates(now() - interval '7 days', 100000)
           where copy_id in ('71000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000003')),
  0, 'copies in a library with no price region are not refreshed');
update public.libraries set price_region = 'EBAY_CA' where id = '10000000-0000-0000-0000-00000000000a';
select is((select array_agg(copy_id) from public.price_refresh_candidates(now() - interval '7 days', 100000)
           where copy_id in ('71000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000003')),
  array['71000000-0000-0000-0000-000000000001'::uuid], 'only the physical copy with an ISBN is a candidate');
update public.copies set price_checked_at = now() - interval '2 days' where id = '71000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.price_refresh_candidates(now() - interval '7 days', 100000)
           where copy_id = '71000000-0000-0000-0000-000000000001'),
  0, 'a copy checked within 7 days is not a candidate');
update public.copies set price_checked_at = now() - interval '9 days' where id = '71000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.price_refresh_candidates(now() - interval '7 days', 100000)
           where copy_id = '71000000-0000-0000-0000-000000000001'),
  1, 'a copy checked more than 7 days ago is a candidate again');

-- ======================================================================= Phase 6b: access control
-- Fixtures: ivy (the app admin), jack (an ordinary person who owns Lib J and has no entitlement yet), gwen (a Google sign-up).
-- Real admins may exist on a hosted project; inside this rolled-back transaction only ivy stays, so "last admin" is testable.
select pg_temp.act_as_admin();
insert into auth.users (id, aud, role, email, raw_user_meta_data) values
  ('a7000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'ivy@example.com', '{}'),
  ('a7000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'jack@example.com', '{}'),
  ('a7000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 'gwen@example.com',
   '{"full_name": "Gwen Google", "picture": "https://example.com/gwen.png", "iss": "https://accounts.google.com"}');
delete from public.app_admins where user_id <> 'a7000000-0000-0000-0000-000000000009';
insert into public.app_admins (user_id) values ('a7000000-0000-0000-0000-000000000009') on conflict do nothing;
insert into public.libraries (id, name, owner_id) values
  ('10000000-0000-0000-0000-0000000000e1', 'Lib J', 'a7000000-0000-0000-0000-00000000000a');

-- A first-time Google sign-up: the profile is built from the Google claims, with no region yet (the app then asks for one).
select is((select display_name || '|' || avatar_url from public.profiles where id = 'a7000000-0000-0000-0000-00000000000b'),
  'Gwen Google|https://example.com/gwen.png', 'a Google sign-up gets a profile with its name and picture');
select is((select region from public.profiles where id = 'a7000000-0000-0000-0000-00000000000b'),
  null, 'a Google sign-up has no region yet, so the app asks for one');

-- Reads: a person sees only their own entitlement and admin row; an admin sees all.
select pg_temp.act_as('a7000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.user_entitlements
  where user_id in ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002')),
  0, 'a person cannot read other people''s entitlements');
select is((select count(*)::int from public.app_admins where user_id = 'a7000000-0000-0000-0000-000000000009'),
  0, 'a person cannot see who the admins are');
select is(public.has_full_access('a7000000-0000-0000-0000-00000000000a'), false, 'a new person has no full access');
-- Writes: nothing signed in can write the tables directly, and the RPCs refuse non-admins.
select throws_ok(
  $$insert into public.user_entitlements (user_id, full_access) values ('a7000000-0000-0000-0000-00000000000a', true)$$,
  '42501', null, 'a person cannot grant themselves access with a direct insert');
select throws_ok(
  $$update public.user_entitlements set full_access = true where user_id = 'a0000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'a person cannot edit an entitlement directly');
select throws_ok(
  $$insert into public.app_admins (user_id) values ('a7000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'a person cannot make themselves an admin directly');
select throws_ok(
  $$select public.set_full_access('a7000000-0000-0000-0000-00000000000a', true)$$,
  '42501', null, 'set_full_access refuses a non-admin');
select throws_ok(
  $$select public.set_app_admin('a7000000-0000-0000-0000-00000000000a', true)$$,
  '42501', null, 'set_app_admin refuses a non-admin');
select throws_ok(
  $$select * from public.admin_list_accounts()$$,
  '42501', null, 'admin_list_accounts refuses a non-admin');
-- Defense in depth: without the entitlement the three paid tables refuse an insert, even with the right library role.
select throws_ok(
  $$insert into public.scan_jobs (library_id, photo_path) values
    ('10000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1/a7000000-0000-0000-0000-00000000000a/one.jpg')$$,
  '42501', null, 'a scan job needs full access');
select throws_ok(
  $$insert into public.recommendation_sets (user_id, library_id, scope) values
    ('a7000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000e1', 'personal')$$,
  '42501', null, 'a personal recommendation set needs full access');
select throws_ok(
  $$insert into public.recommendation_sets (user_id, library_id, scope, requested_by) values
    (null, '10000000-0000-0000-0000-0000000000e1', 'shared', 'a7000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'a shared recommendation set needs the requester''s full access');
select throws_ok(
  $$insert into public.price_check_log (user_id) values ('a7000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'a price check needs full access');
reset role;

-- Your own entitlement is readable.
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.user_entitlements
  where user_id in ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002')),
  1, 'a person reads only their own entitlement row');
reset role;

-- The admin grants.
select pg_temp.act_as('a7000000-0000-0000-0000-000000000009');
select is((select count(*)::int from public.user_entitlements
  where user_id in ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002')),
  2, 'an admin reads every entitlement');
select is((select count(*)::int from public.app_admins where user_id = 'a7000000-0000-0000-0000-000000000009'),
  1, 'an admin can see the admin list');
select lives_ok(
  $$select public.set_full_access('a7000000-0000-0000-0000-00000000000a', true)$$,
  'an admin can grant full access');
select is((select granted_by from public.user_entitlements where user_id = 'a7000000-0000-0000-0000-00000000000a'),
  'a7000000-0000-0000-0000-000000000009'::uuid, 'the grant records who made it');
select is(public.has_full_access('a7000000-0000-0000-0000-00000000000a'), true, 'the granted person has full access');
reset role;

select pg_temp.act_as('a7000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$insert into public.scan_jobs (library_id, photo_path) values
    ('10000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1/a7000000-0000-0000-0000-00000000000a/two.jpg')$$,
  'with full access a scan job can be created');
select lives_ok(
  $$insert into public.recommendation_sets (user_id, library_id, scope) values
    ('a7000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000e1', 'personal')$$,
  'with full access a personal recommendation set can be stored');
select lives_ok(
  $$insert into public.recommendation_sets (user_id, library_id, scope, requested_by) values
    (null, '10000000-0000-0000-0000-0000000000e1', 'shared', 'a7000000-0000-0000-0000-00000000000a')$$,
  'with full access a shared recommendation set can be stored');
select lives_ok(
  $$insert into public.price_check_log (user_id) values ('a7000000-0000-0000-0000-00000000000a')$$,
  'with full access a price check can be logged');
select is((select full_access from public.user_entitlements where user_id = 'a7000000-0000-0000-0000-00000000000a'),
  true, 'the granted person reads their own entitlement');
reset role;

-- The admin lists accounts and revokes.
select pg_temp.act_as('a7000000-0000-0000-0000-000000000009');
select is((select email || '|' || full_access::text || '|' || is_admin::text || '|' || library_count::text
  from public.admin_list_accounts() where user_id = 'a7000000-0000-0000-0000-00000000000a'),
  'jack@example.com|true|false|1', 'admin_list_accounts returns email, access, admin flag and library count');
select is((select is_admin from public.admin_list_accounts() where user_id = 'a7000000-0000-0000-0000-000000000009'),
  true, 'admin_list_accounts flags admins');
select lives_ok(
  $$select public.set_full_access('a7000000-0000-0000-0000-00000000000a', false)$$,
  'an admin can revoke full access');
select is(public.has_full_access('a7000000-0000-0000-0000-00000000000a'), false, 'a revoked person has no full access');
reset role;

select pg_temp.act_as('a7000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$insert into public.scan_jobs (library_id, photo_path) values
    ('10000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1/a7000000-0000-0000-0000-00000000000a/three.jpg')$$,
  '42501', null, 'after a revoke a new scan job is refused again');
select is(pg_temp.affected($$update public.scan_jobs set error = 'x' where photo_path like '%/two.jpg'$$),
  1, 'a revoked person can still update a job they already started');
reset role;

-- Admins: the last one cannot be removed.
select pg_temp.act_as('a7000000-0000-0000-0000-000000000009');
select lives_ok(
  $$select public.set_app_admin('a7000000-0000-0000-0000-00000000000a', true)$$,
  'an admin can add another admin');
select lives_ok(
  $$select public.set_app_admin('a7000000-0000-0000-0000-00000000000a', false)$$,
  'an admin can remove another admin');
select throws_ok(
  $$select public.set_app_admin('a7000000-0000-0000-0000-000000000009', false)$$,
  '55000', null, 'the last admin cannot be removed');
select is(public.is_app_admin('a7000000-0000-0000-0000-000000000009'), true, 'the last admin is still an admin');
reset role;

-- Function privileges: nobody anonymous, and the service role can call the helper.
select is(has_function_privilege('anon', 'public.set_full_access(uuid, boolean)', 'execute'), false, 'anon cannot execute set_full_access');
select is(has_function_privilege('service_role', 'public.has_full_access(uuid)', 'execute'), true, 'the service role can execute has_full_access');

-- The daily price refresh skips a library with no member who has full access.
select pg_temp.act_as_admin();
update public.user_entitlements set full_access = false
  where user_id in ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.price_refresh_candidates(now() - interval '7 days', 100000)
           where copy_id = '71000000-0000-0000-0000-000000000001'),
  0, 'a library with no granted member is not price-refreshed');
update public.user_entitlements set full_access = true where user_id = 'b0000000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.price_refresh_candidates(now() - interval '7 days', 100000)
           where copy_id = '71000000-0000-0000-0000-000000000001'),
  1, 'one granted member is enough for the library to be price-refreshed');

select finish();
rollback;
