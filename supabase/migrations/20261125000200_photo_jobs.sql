-- Photo scans on the job queue (see docs/plans/background-jobs.md, section 4).
--
-- A `photo_scan` job is one batch of photos. Each photo keeps its own scan_jobs row (its result and its Storage
-- cleanup); job_id links the row to its batch. jobs.kind already allows 'photo_scan' (20261125000000_jobs.sql), so
-- no check constraint changes here. Deleting a batch's job leaves the photos in place for the cleanup sweep.

alter table public.scan_jobs
  add column job_id uuid references public.jobs (id) on delete set null;

create index scan_jobs_job_id_idx on public.scan_jobs (job_id) where job_id is not null;
