-- MyHomeLibrary: full data model (all phases). Row-Level Security lives in the next migration.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.library_role as enum ('owner', 'editor', 'viewer');
create type public.book_ownership as enum ('owned', 'wishlist');
create type public.book_format as enum ('hardcover', 'paperback', 'ebook', 'audiobook');
create type public.book_condition as enum ('new', 'like_new', 'very_good', 'good', 'acceptable');
create type public.reading_status as enum ('want', 'reading', 'read', 'dnf');
create type public.recommendation_feedback_type as enum ('not_interested', 'wishlisted', 'already_read');
create type public.scan_status as enum ('pending', 'processing', 'ready', 'saved', 'failed');

-- ---------------------------------------------------------------------------
-- Generic updated_at trigger
-- ---------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(new.email, '@', 1)
    ),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Libraries, members, invites
-- ---------------------------------------------------------------------------
create table public.libraries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index libraries_owner_id_idx on public.libraries (owner_id);

create table public.library_members (
  library_id uuid not null references public.libraries (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.library_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (library_id, user_id)
);
create index library_members_user_id_idx on public.library_members (user_id);

create table public.library_invites (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries (id) on delete cascade,
  email text not null check (email = lower(btrim(email))),
  role public.library_role not null default 'viewer' check (role <> 'owner'),
  token text not null unique
    default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  invited_by uuid default auth.uid() references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index library_invites_library_id_idx on public.library_invites (library_id);

-- Creating a library makes its creator an owner member.
create function public.add_owner_as_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.library_members (library_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger on_library_created
  after insert on public.libraries
  for each row execute function public.add_owner_as_member();

-- ---------------------------------------------------------------------------
-- Series cache (global, written by the server with the service role)
-- ---------------------------------------------------------------------------
create table public.series (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  hardcover_id bigint unique,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.series_entries (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series (id) on delete cascade,
  position numeric,
  title text not null,
  authors text[] not null default '{}',
  hardcover_book_id bigint,
  isbn13 text,
  cover_url text,
  release_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (series_id, hardcover_book_id)
);
create index series_entries_series_id_idx on public.series_entries (series_id, position);
create index series_entries_isbn13_idx on public.series_entries (isbn13);

-- ---------------------------------------------------------------------------
-- Books and copies
-- ---------------------------------------------------------------------------
create table public.books (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries (id) on delete cascade,
  title text not null,
  subtitle text,
  authors text[] not null default '{}',
  series_id uuid references public.series (id) on delete set null,
  series_position numeric,
  description text,
  cover_url text,
  page_count integer check (page_count is null or page_count > 0),
  published_date text,
  genres text[] not null default '{}',
  isbn13 text,
  hardcover_id bigint,
  google_books_id text,
  ol_key text,
  public_rating numeric(3, 2),
  public_rating_count integer,
  rating_source text,
  ownership public.book_ownership not null default 'owned',
  added_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index books_library_id_idx on public.books (library_id);
create index books_library_isbn13_idx on public.books (library_id, isbn13);
create index books_series_id_idx on public.books (series_id);
create index books_library_title_idx on public.books (library_id, lower(title));

create table public.copies (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  format public.book_format not null default 'paperback',
  condition public.book_condition,
  edition_isbn text,
  purchase_price numeric(10, 2) check (purchase_price is null or purchase_price >= 0),
  purchase_date date,
  current_price numeric(10, 2) check (current_price is null or current_price >= 0),
  price_checked_at timestamptz,
  price_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index copies_book_id_idx on public.copies (book_id);

create table public.price_history (
  id uuid primary key default gen_random_uuid(),
  copy_id uuid not null references public.copies (id) on delete cascade,
  price numeric(10, 2) not null check (price >= 0),
  source text not null,
  checked_at timestamptz not null default now()
);
create index price_history_copy_id_idx on public.price_history (copy_id, checked_at desc);

create table public.loans (
  id uuid primary key default gen_random_uuid(),
  copy_id uuid not null references public.copies (id) on delete cascade,
  borrower_name text not null,
  loaned_at timestamptz not null default now(),
  due_at timestamptz,
  returned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index loans_copy_id_idx on public.loans (copy_id);
create index loans_open_idx on public.loans (copy_id) where returned_at is null;

-- ---------------------------------------------------------------------------
-- Shelves
-- ---------------------------------------------------------------------------
create table public.shelves (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  color text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shelves_library_id_idx on public.shelves (library_id, sort_order);

create table public.shelf_books (
  shelf_id uuid not null references public.shelves (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  position integer not null default 0,
  primary key (shelf_id, book_id)
);
create index shelf_books_book_id_idx on public.shelf_books (book_id);

-- ---------------------------------------------------------------------------
-- Per-person reading data
-- ---------------------------------------------------------------------------
create table public.user_books (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  status public.reading_status not null default 'want',
  started_at date,
  finished_at date,
  rating numeric(2, 1) check (rating is null or (rating between 0.5 and 5 and rating * 2 = floor(rating * 2))),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);
create index user_books_book_id_idx on public.user_books (book_id);

-- ---------------------------------------------------------------------------
-- Recommendations and scanning
-- ---------------------------------------------------------------------------
create table public.recommendation_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  library_id uuid not null references public.libraries (id) on delete cascade,
  generated_at timestamptz not null default now(),
  prompt_context jsonb not null default '{}',
  items jsonb not null default '[]'
);
create index recommendation_sets_user_idx on public.recommendation_sets (user_id, library_id, generated_at desc);
create index recommendation_sets_library_id_idx on public.recommendation_sets (library_id);

create table public.recommendation_feedback (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  work_key text not null,
  feedback public.recommendation_feedback_type not null,
  created_at timestamptz not null default now(),
  primary key (user_id, work_key)
);

create table public.scan_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  library_id uuid not null references public.libraries (id) on delete cascade,
  photo_path text not null,
  status public.scan_status not null default 'pending',
  detected jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index scan_jobs_user_id_idx on public.scan_jobs (user_id, created_at desc);
create index scan_jobs_library_id_idx on public.scan_jobs (library_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'libraries', 'series', 'series_entries', 'books', 'copies',
    'loans', 'shelves', 'user_books', 'scan_jobs'
  ]
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime: one member's edits appear live for the others
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime
      add table public.books, public.copies, public.user_books, public.shelves, public.shelf_books;
  end if;
end;
$$;
