-- jobs, job_changes and claim_job. Run with `npx supabase test db` against a local stack. All rolled back.
-- Fixtures: alice owns the library, bob is an editor who started the job, carol a viewer, dave is not a member.
begin;
select plan(18);

insert into auth.users (id, aud, role, email) values
  ('a0000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'alice-jobs@example.com'),
  ('b0000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 'bob-jobs@example.com'),
  ('c0000000-0000-0000-0000-0000000000a3', 'authenticated', 'authenticated', 'carol-jobs@example.com'),
  ('d0000000-0000-0000-0000-0000000000a4', 'authenticated', 'authenticated', 'dave-jobs@example.com');
insert into public.libraries (id, name, owner_id) values
  ('10000000-0000-0000-0000-0000000000f1', 'Jobs library', 'a0000000-0000-0000-0000-0000000000a1'),
  ('10000000-0000-0000-0000-0000000000f2', 'Other jobs library', 'd0000000-0000-0000-0000-0000000000a4');
insert into public.library_members (library_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-0000000000a2', 'editor'),
  ('10000000-0000-0000-0000-0000000000f1', 'c0000000-0000-0000-0000-0000000000a3', 'viewer');
insert into public.books (id, library_id, title, authors) values
  ('30000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', 'Jobbed', '{"A"}');

insert into public.jobs (id, library_id, user_id, kind, status) values
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-0000000000a2', 'series_lookup', 'running'),
  ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-0000000000a2', 'photo_scan', 'done');
insert into public.job_changes (job_id, book_id, before, after) values
  ('70000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000f1', '{"series_name": null}', '{"series_name": "Saga"}');

-- One active series lookup per library.
select throws_ok(
  $$insert into public.jobs (library_id, user_id, kind) values ('10000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000a1', 'series_lookup')$$,
  '23505', null, 'a second active series lookup in the same library is refused');
select lives_ok(
  $$insert into public.jobs (library_id, user_id, kind) values ('10000000-0000-0000-0000-0000000000f2', 'd0000000-0000-0000-0000-0000000000a4', 'series_lookup')$$,
  'another library may have its own');
select lives_ok(
  $$insert into public.jobs (library_id, user_id, kind, status) values ('10000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000a1', 'series_lookup', 'done')$$,
  'finished lookups do not count as active');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- Reads.
select pg_temp.act_as('c0000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.jobs where library_id = '10000000-0000-0000-0000-0000000000f1'), 3, 'a member (viewer) reads the library''s jobs');
select is((select count(*)::int from public.job_changes), 1, 'a member reads the undo log');
select throws_ok($$insert into public.jobs (library_id, kind) values ('10000000-0000-0000-0000-0000000000f1', 'photo_scan')$$, '42501', null, 'a member cannot create jobs');
select throws_ok($$delete from public.job_changes$$, '42501', null, 'a member cannot delete the undo log (no delete privilege)');
update public.jobs set seen_at = now() where id = '70000000-0000-0000-0000-000000000002';
select is((select seen_at from public.jobs where id = '70000000-0000-0000-0000-000000000002'), null, 'a viewer who did not start a job cannot mark it seen (the update matches no row)');

select pg_temp.act_as('d0000000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from public.jobs where library_id = '10000000-0000-0000-0000-0000000000f1'), 0, 'a non-member reads none of the library''s jobs');
select is((select count(*)::int from public.job_changes), 0, 'a non-member reads none of its undo log');

-- Cancel and seen_at.
select pg_temp.act_as('b0000000-0000-0000-0000-0000000000a2');
update public.jobs set seen_at = now() where id = '70000000-0000-0000-0000-000000000002';
select isnt((select seen_at from public.jobs where id = '70000000-0000-0000-0000-000000000002'), null, 'the person who started a job marks it seen');
select throws_ok($$update public.jobs set status = 'done' where id = '70000000-0000-0000-0000-000000000001'$$, '42501', null, 'a person cannot mark a job done');
select throws_ok($$update public.jobs set processed = 99 where id = '70000000-0000-0000-0000-000000000001'$$, '42501', null, 'a person cannot write progress');
update public.jobs set status = 'cancelled' where id = '70000000-0000-0000-0000-000000000001';
select is((select status from public.jobs where id = '70000000-0000-0000-0000-000000000001'), 'cancelled', 'the job is cancelled');

-- claim_job: service role only.
select pg_temp.act_as('a0000000-0000-0000-0000-0000000000a1');
select throws_ok($$select * from public.claim_job('run-x', array['series_lookup'])$$, '42501', null, 'signed-in people cannot claim jobs');

reset role;
-- Make the queue deterministic: leave exactly two queued jobs, one of them held back.
delete from public.jobs where id <> '70000000-0000-0000-0000-000000000001';
insert into public.jobs (id, library_id, user_id, kind, status, created_at) values
  ('70000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000a1', 'photo_scan', 'queued', now() - interval '2 minutes'),
  ('70000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-0000000000f2', 'd0000000-0000-0000-0000-0000000000a4', 'series_lookup', 'queued', now() - interval '1 minute');
update public.jobs set not_before = now() + interval '1 hour' where id = '70000000-0000-0000-0000-000000000010';

select is((select id from public.claim_job('run-1', array['series_lookup'])), '70000000-0000-0000-0000-000000000011'::uuid, 'claim_job hands out a due job of an allowed kind and skips one held by not_before');
select is((select count(*)::int from public.claim_job('run-2', array['series_lookup', 'photo_scan'])), 0, 'a leased job is not handed out twice, and a job before not_before is not due');
update public.jobs set locked_until = now() - interval '1 second' where id = '70000000-0000-0000-0000-000000000011';
select is((select locked_by from public.claim_job('run-3', array['series_lookup'])), 'run-3', 'once the lease has run out another run takes the job over');

select * from finish();
rollback;
