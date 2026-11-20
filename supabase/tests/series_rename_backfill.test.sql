-- library_rename_series and the series_name backfill. Run with `npx supabase test db` against a local stack.
-- Fixtures: alice owns the library, bob is a viewer. All rolled back.
begin;
select plan(9);

insert into auth.users (id, aud, role, email) values
  ('a0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'alice@example.com'),
  ('b0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'bob@example.com');
insert into public.libraries (id, name, owner_id) values ('10000000-0000-0000-0000-0000000000f1', 'Rename library', 'a0000000-0000-0000-0000-000000000001');
insert into public.library_members (library_id, user_id, role) values ('10000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-000000000002', 'viewer');

insert into public.series (id, name, hardcover_id) values ('20000000-0000-0000-0000-0000000000a1', 'Dune', 990001);
insert into public.series_entries (series_id, position, title, hardcover_book_id) values ('20000000-0000-0000-0000-0000000000a1', 2, 'Dune Messiah', 880002);

insert into public.books (id, library_id, title, authors, series_name, series_position, series_id, hardcover_id) values
  ('30000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000f1', 'Linked, empty', '{"Frank Herbert"}', null, null, '20000000-0000-0000-0000-0000000000a1', 880002),
  ('30000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-0000000000f1', 'Linked, typed', '{"Frank Herbert"}', 'My Dune', 5, '20000000-0000-0000-0000-0000000000a1', 880002),
  ('30000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-0000000000f1', 'Villain 1', '{"Serena Valentino"}', 'Disney Villains', 1, null, null),
  ('30000000-0000-0000-0000-0000000000b4', '10000000-0000-0000-0000-0000000000f1', 'Villain 2', '{"Valentino, Serena"}', 'disney  villains', 2, null, null),
  ('30000000-0000-0000-0000-0000000000b5', '10000000-0000-0000-0000-0000000000f1', 'Other author', '{"Someone Else"}', 'Disney Villains', 3, null, null),
  ('30000000-0000-0000-0000-0000000000b6', '10000000-0000-0000-0000-0000000000f1', 'Accent', '{"Zoë Brontë"}', 'Éclair', 1, null, null);

-- Backfill (the statements from 20261124000000_backfill_series_name.sql), run twice to show it is idempotent.
create function pg_temp.backfill() returns void language sql as $$
  update public.books b set series_name = s.name from public.series s
  where b.series_id = s.id and nullif(btrim(b.series_name), '') is null and nullif(btrim(s.name), '') is not null;
  update public.books b set series_position = e.position from public.series_entries e
  where b.series_id is not null and e.series_id = b.series_id and e.hardcover_book_id = b.hardcover_id
    and b.series_position is null and e.position is not null;
$$;
select pg_temp.backfill();
select pg_temp.backfill();
select is((select series_name || '/' || series_position from public.books where id = '30000000-0000-0000-0000-0000000000b1'), 'Dune/2', 'backfill fills an empty name and number');
select is((select series_name || '/' || series_position from public.books where id = '30000000-0000-0000-0000-0000000000b2'), 'My Dune/5', 'backfill keeps typed values');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

select pg_temp.act_as('b0000000-0000-0000-0000-000000000002');
select is(public.library_rename_series('10000000-0000-0000-0000-0000000000f1', 'Disney Villains', 'Villains'), 0, 'a viewer renames nothing (RLS)');

select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
select is(public.library_rename_series('10000000-0000-0000-0000-0000000000f1', 'DISNEY villains', 'Villains', 'Serena Valentino'), 1,
  'author scope: only that author, matched case-insensitively (the double-spaced variant is a different name)');
select is((select series_name from public.books where id = '30000000-0000-0000-0000-0000000000b5'), 'Disney Villains', 'another author is untouched');
select is(public.library_rename_series('10000000-0000-0000-0000-0000000000f1', 'Disney Villains', 'Villains'), 1, 'without an author, every remaining match is renamed');
select is(public.library_rename_series('10000000-0000-0000-0000-0000000000f1', 'eclair', 'Éclair Études'), 1, 'accents are folded');
select throws_ok($$select public.library_rename_series('10000000-0000-0000-0000-0000000000f1', 'a', '  ')$$, 'P0001', 'A series name is required', 'an empty new name is refused');
select is((select count(*)::int from public.books where series_name = 'Villains'), 2, 'two books now share the name');

select * from finish();
rollback;
