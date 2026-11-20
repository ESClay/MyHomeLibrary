-- The library screen's sort, saved on the profile: one setting per person, used in every library and on every device.
-- Null means "never chosen" (the app falls back to its default). The existing profiles_update policy already lets a
-- person change their own row, so no new policy is needed.
alter table public.profiles
  add column library_sort text check (library_sort in ('added','title','author','series','myrating','rating','price')),
  add column library_sort_dir text check (library_sort_dir in ('asc','desc'));
