-- library_rename_author and library_authors. Run with `npx supabase test db` against a local stack. All rolled back.
begin;
select plan(8);

insert into auth.users (id, aud, role, email) values
  ('a0000000-0000-0000-0000-000000000011', 'authenticated', 'authenticated', 'alice-author@example.com'),
  ('b0000000-0000-0000-0000-000000000012', 'authenticated', 'authenticated', 'bob-author@example.com');
insert into public.libraries (id, name, owner_id) values ('10000000-0000-0000-0000-0000000000e1', 'Author library', 'a0000000-0000-0000-0000-000000000011');
insert into public.library_members (library_id, user_id, role) values ('10000000-0000-0000-0000-0000000000e1', 'b0000000-0000-0000-0000-000000000012', 'viewer');
insert into public.books (id, library_id, title, authors) values
  ('30000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000e1', 'One', '{"Gail Z. Martin"}'),
  ('30000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000e1', 'Two', '{"Gail Z Martin"}'),
  ('30000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-0000000000e1', 'Co-written', '{"Someone Else","gail z. martin"}'),
  ('30000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-0000000000e1', 'Twice', '{"Gail Z Martin","Gail Z. Martin"}'),
  ('30000000-0000-0000-0000-0000000000c5', '10000000-0000-0000-0000-0000000000e1', 'Other', '{"Frank Herbert"}');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

select pg_temp.act_as('b0000000-0000-0000-0000-000000000012');
select is(public.library_rename_author('10000000-0000-0000-0000-0000000000e1', 'Gail Z Martin', 'Gail Z. Martin'), 0, 'a viewer changes nothing (RLS)');

select pg_temp.act_as('a0000000-0000-0000-0000-000000000011');
select is((select count(*)::int from public.library_authors('10000000-0000-0000-0000-0000000000e1') where author like 'Gail%' or author like 'gail%'), 3, 'three spellings are listed');
select is(public.library_rename_author('10000000-0000-0000-0000-0000000000e1', 'GAIL z martin', 'Gail Z. Martin'), 3, 'punctuation and case are ignored; the three books not already spelled that way change');
select is((select authors from public.books where id = '30000000-0000-0000-0000-0000000000c2'), array['Gail Z. Martin'], 'the spelling is replaced');
select is((select authors from public.books where id = '30000000-0000-0000-0000-0000000000c3'), array['Someone Else', 'Gail Z. Martin'], 'any position, order kept');
select is((select authors from public.books where id = '30000000-0000-0000-0000-0000000000c4'), array['Gail Z. Martin'], 'a repeat of the same person is dropped');
select is((select authors from public.books where id = '30000000-0000-0000-0000-0000000000c5'), array['Frank Herbert'], 'other authors are untouched');
select throws_ok($$select public.library_rename_author('10000000-0000-0000-0000-0000000000e1', 'x', '  ')$$, 'P0001', 'An author name is required', 'an empty new name is refused');

select * from finish();
rollback;
