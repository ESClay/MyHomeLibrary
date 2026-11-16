-- Phase 6 (part 1): new enum values. ALTER TYPE ... ADD VALUE cannot be used in the same transaction that adds it,
-- so it lives in its own migration; the next file relies on it.
alter type public.book_ownership add value if not exists 'borrowed';
create type public.loan_direction as enum ('out', 'in');
