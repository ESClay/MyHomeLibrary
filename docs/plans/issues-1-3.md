# Plan: GitHub issues #1, #2, #3

Build order: **#2 → #1 → #3**. #2 changes the default sort, which #1 falls back to. #3 stands alone but touches the same file (`library-browser.tsx`), so it goes last.

Per CLAUDE.md, the code is written by a Sonnet subagent, and any UI work starts with the `design-taste-frontend` skill and passes its finish gate.

Decisions already made with the user:
- Sort preference: one per person, stored on the profile (not per library, not a cookie).
- Author sort descending: only the author order flips. Series and book numbers stay in reading order.
- Standalones: a book with a series (novellas too, e.g. position 2.5) sorts inside that series. Books with no series come after all of that author's series.
- Bulk condition/format: only books with exactly one copy are changed. Books with several copies are skipped and counted in the result.

---

## Issue #2: Author sort sub-sorts by series, and becomes the default

**Target order for `sort=author`:**
1. First author's last name (`sort_author`), in the chosen direction.
2. First author's full name, in the same direction, so two authors who share a last name (two Smiths) don't get mixed together.
3. Books with a series before books without one.
4. Series name, ascending (`library_sort` collation).
5. Series position, ascending, nulls last. The column is `numeric`, so 2.5 works.
6. Title (`sort_title`), then `id`.

Steps 3 to 6 are always ascending.

**Changes**
- `src/lib/books/library-query.ts`
  - `compareByKey` `"author"` case: build the chain above. Only steps 1 and 2 use `sign`.
  - Default sort `"added"` → `"author"` in `parseLibraryParams` and `paramsToRaw` (you can pull it out into a `DEFAULT_SORT` constant). `DEFAULT_DIR.author` is already `asc`.
  - Put `"author"` first in `SORTS` so it comes first in the dropdown.
- New migration `supabase/migrations/20261123000000_author_series_sort.sql`
  - `create or replace function public.library_page(...)`, with the same signature and only these changes:
    - The `'author'` branch of `v_order` becomes: `b.sort_author %s, (b.authors[1] collate public.library_sort) %s, (nullif(b.series_name,'') is null), nullif(b.series_name,'') collate public.library_sort asc, b.series_position asc nulls last, b.sort_title, b.id`.
    - The fallback in `v_sort` changes from `'added'` to `'author'`.
  - Copy the function body from `20261122000000_library_page.sql`. Don't edit the old migration.
- Check other callers: `src/lib/shelves/rules.ts` `paramsFromRules` passes an explicit sort, so smart shelves keep their own default. Confirm no caller relied on `"added"` being the implicit default (`src/lib/books/data.ts`, `src/lib/shelves/data.ts`).

**Tests**
- `src/lib/books/library-fixture.ts`: add books for these cases: one author with two series plus a standalone; a novella at position 2.5; two authors with the same last name; a series book with no position.
- `library-query.test.ts`: test author asc and author desc (series order stays the same when desc). Test that the default sort is `author`.
- `supabase/tests/library_page.test.sql`: the SQL order matches the JS reference on the fixture, for both directions.

**Data note for the user:** a novella only lands in its series if its series name and position are filled in. Books missing them can be fixed by editing the book or with the bulk metadata pull from #3.

---

## Issue #1: Remember the chosen sort on the profile

**Changes**
- New migration `supabase/migrations/20261123000100_profile_library_sort.sql`
  - `alter table public.profiles add column library_sort text check (library_sort in ('added','title','author','series','myrating','rating','price')), add column library_sort_dir text check (library_sort_dir in ('asc','desc'));`
  - Check that the existing RLS lets a user update their own profile row. Add a policy only if it doesn't.
- `src/lib/books/library-query.ts`
  - `parseLibraryParams(raw, fallback?: { sort: Sort; dir: "asc" | "desc" })`: use the URL's `sort` when it has one, otherwise `fallback`, otherwise `author`. If the URL has `sort` but no `dir`, use `DEFAULT_DIR[sort]`.
  - `paramsToRaw`: **always** write `sort` and `dir`. With a saved preference there is no fixed default to leave out, and leaving one out would let the profile's sort override what the URL asked for. `loadLibraryPage` re-parses via `paramsToRaw`, so it stays consistent.
- `src/app/(app)/library/actions.ts`: add `saveLibrarySort({ sort, dir })`. Validate with `SORTS`, update `profiles` where `id = user.id` through the user's client, and return `ActionResult`.
- `src/app/(app)/library/page.tsx`: load `library_sort, library_sort_dir` for the user (in the existing `Promise.all`) and pass them to `parseLibraryParams` as the fallback.
- `src/app/(app)/library/library-browser.tsx`: in the sort select's `onChange` and the direction toggle, call `saveLibrarySort` (fire and forget, ignore errors) next to `go(...)`. The URL now carries the sort, so navigation doesn't wait on the save.
- Leave out: shelf detail sort and Discover. This is only the main library screen, as the issue asks.

**Tests**
- `library-query.test.ts`: the fallback is used when the URL has no sort, the URL sort wins over the fallback, and `paramsToRaw` → `parseLibraryParams` gives back the same params.
- `actions.test.ts`: `saveLibrarySort` rejects an unknown sort and writes only the caller's own row.
- e2e (`e2e/books.spec.ts` or a new spec): pick "Title", go to Shelves, click Library in the nav, and "Title" is still selected. Reload: still "Title".

---

## Issue #3: Bulk update and metadata pull from multi-select

**What the user gets:** in select mode, the sticky bar gets two more actions next to Add to shelf / Remove from shelf:
- **Edit selected**: opens a sheet with three optional fields: My status, Format, Condition. Each starts as "Leave as is". Apply runs only the fields that were set.
- **Refresh metadata**: runs a paced refresh over the selection, with progress ("Refreshing 4 of 20"), a Stop button and a summary at the end.

Viewers see only My status (it's per person, and RLS pins `user_id`). Format, Condition and Refresh metadata need edit rights (`canEdit(role)`).

**Server: new file `src/app/(app)/library/bulk-actions.ts`**
- Shared guard: `libraryId` must be in the user's libraries, there must be 1 to 500 `bookIds` (uuids), and every id must belong to that library (one `select id from books where library_id = ? and id = any(?)`; reject if the counts differ).
- `bulkSetStatus({ libraryId, bookIds, status })`: one `user_books` upsert of `{ user_id, book_id, status }` rows, `onConflict: user_id,book_id`. Ratings and notes stay as they are.
- `bulkSetCopyFields({ libraryId, bookIds, format?, condition? })`: needs edit rights, and at least one field must be set.
  - Load `copies(id, book_id)` for the ids and group by book.
  - Exactly 1 copy: update that copy's set fields.
  - 0 copies and `ownership = 'owned'`: insert a copy with the set fields (format defaults to `paperback` as in the schema).
  - 0 copies, wishlist or borrowed: skip. Don't create a copy, because `addCopy` would flip a wishlist book to owned.
  - 2 or more copies: skip.
  - Returns `{ updated, created, skippedMultiCopy, skippedNoCopy }`.
- After each action, call `revalidatePath("/library")` once, not once per book.
- Validate with zod, reusing `FORMATS`, `CONDITIONS` and `STATUSES` from `src/lib/books/constants.ts`.

**Metadata pull:** the client drives it and reuses the existing `refreshMetadata(bookId)` in `src/app/(app)/books/actions.ts`. That function already handles authorization, the provider policy and full-access quota.
- Run one book at a time, with `LOOKUP_GAP_MS` (`src/lib/calibre/limits.ts`) between calls so Hardcover's rate limit holds.
- Stop on a full-access denial and show its message. Count the other failures and keep going.
- Cap a run at 100 books. If more are selected, say so and ask the user to narrow the selection.
- When done, `router.refresh()`, show a summary in `notice` ("Updated 14, already up to date 4, no match 2"), and leave select mode.
- Optional cleanup: `refreshMetadata` revalidates per book. That's fine at this pace, so leave it.

**UI: `library-browser.tsx` plus a new `src/components/bulk-edit-sheet.tsx`**
- Follow the existing `AssignSheet` pattern (`src/components/assign-sheet.tsx`) for the sheet's structure.
- **Run `design-taste-frontend` first**, for the bar layout once it has four actions (it has to work on a phone; maybe a "More" overflow), for the sheet, and for the progress state. Then run its finish gate.
- The result message names the skips: "Updated 9 books. Skipped 2 with more than one copy."

**Tests**
- Unit (mocked Supabase, like `library/actions.test.ts`): ids outside the library are rejected; a viewer is refused copy fields but allowed status; the 0/1/2+ copy cases give the right counts; status upsert leaves ratings alone.
- e2e: select 3 books, set status "Read", and the list shows "Read". Set the condition on a mix of single- and multi-copy books, and check the skip message.

---

## Handing off to Sonnet

Run it as one Sonnet subagent per issue, in order, each given this file and its section. Each one runs `npm run typecheck`, `npm run lint`, `npm test`, and the relevant `supabase test db` / Playwright spec, and reports the results. #3's agent also reports the `design-taste-frontend` gate result. Opus reviews each one against this plan before the next starts.
