-- Phase 6b: access control. The app is public and sign-up stays open, so the paid (Claude) and quota-limited
-- (eBay, Hardcover, Google Books) features are limited to people an admin has granted "full access".
--
-- These tables are deliberately not columns on `profiles`: people can update their own profile.
--   app_admins        who may manage access (a handful of rows, bootstrapped by hand with the service role).
--   user_entitlements one row per granted (or revoked) person. Written only through the RPCs below or the service role.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.user_entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_access boolean not null default false,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;
alter table public.user_entitlements enable row level security;

-- Nobody signed in writes these directly (no insert/update/delete policies, and no table privileges either).
revoke insert, update, delete, truncate on public.app_admins from anon, authenticated;
revoke insert, update, delete, truncate on public.user_entitlements from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (security definer so the policies below cannot recurse into themselves)
-- ---------------------------------------------------------------------------
create function public.is_app_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_admins where user_id = uid);
$$;

create function public.has_full_access(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.user_entitlements where user_id = uid and full_access);
$$;

revoke all on function public.is_app_admin(uuid) from public, anon;
revoke all on function public.has_full_access(uuid) from public, anon;
grant execute on function public.is_app_admin(uuid) to authenticated, service_role;
grant execute on function public.has_full_access(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Read policies
-- ---------------------------------------------------------------------------
create policy user_entitlements_select on public.user_entitlements for select to authenticated
  using (user_id = (select auth.uid()) or public.is_app_admin((select auth.uid())));

create policy app_admins_select on public.app_admins for select to authenticated
  using (user_id = (select auth.uid()) or public.is_app_admin((select auth.uid())));

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Grants or revokes full access. Admin only. Records who changed it and when it was granted.
create function public.set_full_access(target uuid, enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null or not public.is_app_admin(caller) then
    raise exception 'Only an app admin can change access.' using errcode = '42501';
  end if;
  insert into public.user_entitlements (user_id, full_access, granted_by, granted_at, updated_at)
  values (target, enabled, caller, case when enabled then now() end, now())
  on conflict (user_id) do update
    set full_access = excluded.full_access,
        granted_by = excluded.granted_by,
        granted_at = excluded.granted_at,
        updated_at = now();
end;
$$;

-- Makes someone an admin, or removes them. Admin only. The last admin cannot be removed, so the app cannot lock itself out.
create function public.set_app_admin(target uuid, enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  admins integer;
begin
  if caller is null or not public.is_app_admin(caller) then
    raise exception 'Only an app admin can change admins.' using errcode = '42501';
  end if;
  if enabled then
    insert into public.app_admins (user_id) values (target) on conflict (user_id) do nothing;
    return;
  end if;
  -- Lock the rows so two simultaneous removals cannot both see "another admin remains".
  perform 1 from public.app_admins for update;
  select count(*) into admins from public.app_admins;
  if admins <= 1 and exists (select 1 from public.app_admins where user_id = target) then
    raise exception 'The last admin cannot be removed.' using errcode = '55000';
  end if;
  delete from public.app_admins where user_id = target;
end;
$$;

-- Every account with its access, for the admin page. Admin only.
create function public.admin_list_accounts()
returns table (
  user_id uuid,
  display_name text,
  email text,
  created_at timestamptz,
  full_access boolean,
  is_admin boolean,
  library_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.is_app_admin((select auth.uid())) then
    raise exception 'Only an app admin can list accounts.' using errcode = '42501';
  end if;
  return query
  select
    p.id,
    p.display_name,
    p.email,
    p.created_at,
    coalesce(e.full_access, false),
    exists (select 1 from public.app_admins a where a.user_id = p.id),
    (select count(*)::integer from public.library_members lm where lm.user_id = p.id)
  from public.profiles p
  left join public.user_entitlements e on e.user_id = p.id
  order by p.created_at desc, p.id;
end;
$$;

revoke all on function public.set_full_access(uuid, boolean) from public, anon;
revoke all on function public.set_app_admin(uuid, boolean) from public, anon;
revoke all on function public.admin_list_accounts() from public, anon;
grant execute on function public.set_full_access(uuid, boolean) to authenticated, service_role;
grant execute on function public.set_app_admin(uuid, boolean) to authenticated, service_role;
grant execute on function public.admin_list_accounts() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Defense in depth: the paid features cannot be started from a user session without the entitlement.
-- The server checks first (src/lib/access.ts); these make a missed check fail closed. The cron uses the service role.
-- ---------------------------------------------------------------------------

-- scan_jobs: one "all" policy becomes per-command ones so only INSERT needs the entitlement. A person who is later
-- revoked can still finish, read or delete their own jobs.
drop policy scan_jobs_all on public.scan_jobs;
create policy scan_jobs_select on public.scan_jobs for select to authenticated
  using (user_id = (select auth.uid()));
create policy scan_jobs_insert on public.scan_jobs for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.can_edit_library(library_id, (select auth.uid()))
    and public.has_full_access((select auth.uid()))
  );
create policy scan_jobs_update on public.scan_jobs for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.can_edit_library(library_id, (select auth.uid())));
create policy scan_jobs_delete on public.scan_jobs for delete to authenticated
  using (user_id = (select auth.uid()));

-- recommendation_sets: personal and shared sets stored by a user session need the requester's entitlement.
drop policy recommendation_sets_insert on public.recommendation_sets;
create policy recommendation_sets_insert on public.recommendation_sets for insert to authenticated
  with check (
    public.has_full_access((select auth.uid()))
    and public.is_library_member(library_id, (select auth.uid()))
    and (
      (scope = 'personal' and user_id = (select auth.uid()))
      or (scope = 'shared' and user_id is null and requested_by = (select auth.uid()))
    )
  );

-- price_check_log: an on-demand eBay check is logged before it runs, so this stops it at the database too.
drop policy price_check_log_insert on public.price_check_log;
create policy price_check_log_insert on public.price_check_log for insert to authenticated
  with check (user_id = (select auth.uid()) and public.has_full_access((select auth.uid())));

-- ---------------------------------------------------------------------------
-- The daily price refresh only covers libraries with at least one member who has full access.
-- Same signature and result as before (grants are kept), plus the entitlement filter in the query itself so a
-- limit is never spent on libraries that are skipped.
-- ---------------------------------------------------------------------------
create or replace function public.price_refresh_candidates(cutoff timestamptz, max_rows integer)
returns table (copy_id uuid, format public.book_format, condition public.book_condition, isbn text, price_region text, price_checked_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.format, c.condition, coalesce(nullif(c.edition_isbn, ''), nullif(b.isbn13, '')), l.price_region, c.price_checked_at
  from public.copies c
  join public.books b on b.id = c.book_id
  join public.libraries l on l.id = b.library_id
  where c.format in ('hardcover', 'paperback')
    and b.ownership = 'owned'
    and l.price_region is not null
    and coalesce(nullif(c.edition_isbn, ''), nullif(b.isbn13, '')) is not null
    and (c.price_checked_at is null or c.price_checked_at < cutoff)
    and exists (
      select 1
      from public.library_members lm
      join public.user_entitlements ue on ue.user_id = lm.user_id and ue.full_access
      where lm.library_id = l.id
    )
  order by c.price_checked_at asc nulls first, c.id
  limit greatest(max_rows, 0);
$$;
