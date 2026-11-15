-- RLS test plan (pgTAP). Run with `npx supabase test db` against a local stack.
-- It can also run against a hosted project; it then must assume real data exists
-- (so counts only look at the fixture rows) and that hosted-only triggers are active
-- (e.g. storage.protect_delete(), so nothing deletes from storage tables directly).
-- Everything runs in one transaction that is rolled back.
-- Fixtures: alice (owner of Lib A), bob (editor of Lib A), carol (viewer of Lib A),
-- dave (owns Lib B; accepts an invite into Lib A mid-file),
-- eve (member of nothing, ever).
begin;
select plan(57);

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

-- Helper: number of rows a DML statement affected (0 when RLS filters them all out).
create function pg_temp.affected(q text) returns int language plpgsql as $$
declare n int;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;

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

select finish();
rollback;
