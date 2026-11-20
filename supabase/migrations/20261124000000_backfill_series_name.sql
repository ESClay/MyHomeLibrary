-- Backfill series_name / series_position on books the Discover sync linked to a series.
-- The sync used to set only books.series_id, but the library list, sort and series filter read series_name and
-- series_position, so those books sorted as standalones. The sync now fills both; this fills the books linked before.
-- One-off and idempotent: only empty fields are written (a typed name or number is never overwritten), and a second
-- run matches nothing. A book's number comes from the series entry whose hardcover_book_id is the book's hardcover_id.
update public.books b
set series_name = s.name
from public.series s
where b.series_id = s.id
  and nullif(btrim(b.series_name), '') is null
  and nullif(btrim(s.name), '') is not null;

update public.books b
set series_position = e.position
from public.series_entries e
where b.series_id is not null
  and e.series_id = b.series_id
  and e.hardcover_book_id = b.hardcover_id
  and b.series_position is null
  and e.position is not null;
