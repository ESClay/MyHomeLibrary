-- RLS test plan (pgTAP). Run with `npx supabase test db` against a local stack.
-- Fixtures: alice (owner of Lib A), bob (editor of Lib A), carol (viewer of Lib A),
-- dave (member of nothing; owns Lib B).
begin;
select plan(25);

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, aud, role, email) values
  ('a0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'alice@example.com'),
  ('b0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'bob@example.com'),
  ('c0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'carol@example.com'),
  ('d0000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'dave@example.com');

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
select is((select count(*)::int from public.profiles), 4, 'profiles are created on signup');

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

select finish();
rollback;
