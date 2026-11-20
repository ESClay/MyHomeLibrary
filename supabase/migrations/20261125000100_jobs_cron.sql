-- Calls the app's job worker every minute: pg_cron fires, pg_net POSTs to <app url>/api/jobs/tick.
--
-- Nothing secret or host-specific lives in this file. The app URL and the shared secret are read from Supabase Vault
-- each time the schedule fires, by these names:
--   app_url      the app's production URL, e.g. https://my-library.example (no trailing slash needed)
--   cron_secret  the same value as CRON_SECRET on Vercel
-- If either is missing the run is skipped quietly (nothing is posted, nothing errors), so applying this migration
-- before the Vault entries exist is safe; jobs then wait for the daily Vercel cron.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.call_jobs_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'app_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return;
  end if;

  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/jobs/tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
end;
$$;

-- Only the cron runner (postgres) calls this; it reads the secret, so nobody else may.
revoke all on function public.call_jobs_tick() from public, anon, authenticated;

-- Replace the schedule if it already exists, so applying the migration twice is harmless.
do $$
begin
  perform cron.unschedule('jobs-tick');
exception when others then
  null;
end;
$$;

select cron.schedule('jobs-tick', '* * * * *', 'select public.call_jobs_tick()');
