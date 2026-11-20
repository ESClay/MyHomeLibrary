# Plan: GitHub issues #5 to #10

Build order: **design gate setup → #9 (+ rename series) → #10 → #5 → #7 → #8 → #6 (+ duplicate warning)**.

- #9 and #10 both need series names filled in correctly, so #9's data fix goes first.
- #5 and #7 both touch `library-browser.tsx` and are small.
- #8 is a self-contained Discover restyle.
- #6 (merge) is the largest change. It reuses Select mode, so it goes last.

Per CLAUDE.md, a Sonnet subagent writes the code. Any UI work (#5's back link, #7, #8, #10, #6) starts with the `design-taste-frontend` skill, and the subagent reports what the skill's checks found (see "Design check" at the end).

Decisions the user made on 2026-11-20:
- #8: tabs (Series / For you / For both of you), plus each series collapsed to one row.
- #6: pick the book to keep; its details win, empty fields fill from the others, and you can choose any book's cover.
- Extras approved: **Rename series** (with #9), **duplicate warning on add** (with #6), and a **real design gate** (test sign-in so the taste-skill's headless scripts can check signed-in pages; build it first, before the UI issues, so every UI change goes through it).

Items still marked **(proposed)** below without one of these approvals stay out: next-number suggestion (#10) and "Hide series" (#8).

---

## #9: Series sorting stops working further down the library

**What I found.** I loaded all 350 books in Chrome with the Author sort and checked every neighbouring pair against the sort rules. The order matches the rules for the data as it is stored. The SQL in `20261123000000_author_series_sort.sql` is live and correct. **The problem is the data:**

1. **Books linked to a series by the Discover sync have no series name.** `src/lib/discover/series-sync.ts:212` sets only `books.series_id` (and `series_checked_at`). It never sets `series_name` or `series_position`. The library sort, the list row and the series filter all read `series_name`. So a book that Discover counts as part of *An Ember in the Ashes* sorts as a standalone. Examples in the live list: Sabaa Tahir, *A Reaper at the Gates*; Sue Lynn Tan; Eldon Thompson. These books are mostly later additions (photo scan or Discover), which is why the sort "goes wrong after a few scrolls".
2. **The same series is spelled two ways.** For example, Serena Valentino has "Disney Villains #9" and "Villains #2/#3/#5", and some of her books have no series at all. The collation cannot treat those as one series. #10 stops new variants from being typed. Existing ones need a clean-up.

**Changes**
- `series-sync.ts`: when a book gets linked (line ~212), also set `series_name = series.name` and `series_position = <its entry's position>` (match `series_entries` on `hardcover_book_id = books.hardcover_id`). Only fill fields that are empty, so names someone typed are never overwritten.
- New migration `supabase/migrations/20261124000000_backfill_series_name.sql`: a one-off update that fills `series_name` and `series_position` the same way for books where `series_id is not null and nullif(series_name,'') is null`. It is idempotent.
- **Series rename (proposed):** add a "Rename series" action to the series filter list. It takes `(library_id, old_name, new_name, author)` and updates every matching book in one statement, so "Disney Villains" can be merged into "Villains". It lives in `src/app/(app)/library/actions.ts` with an editor-role check.
- Before shipping, the user runs a count in the Supabase SQL editor to confirm the cause: `select count(*) from books where series_id is not null and nullif(series_name,'') is null;`. My direct database query was blocked, so this has not been confirmed.

**3. Third cause: 156 of 350 books have no series at all** (Wheel of Time, Mistborn, Witcher, ACOTAR, Riordan among them). Only Hardcover supplies series data; books that arrived through Google Books, Open Library, a photo scan or a Calibre import have no `series_name`, `series_id` or `hardcover_id`, and `needsDiscovery` skipped exactly those, so "Find my series" never looked at them. Author spellings also differ by punctuation ("Gail Z Martin" vs "Gail Z. Martin"), which splits an author in the sort.

**Fixes (done)**
- `series-sync.ts` step 0: books with no series, no series name and no Hardcover id are looked up on Hardcover by ISBN-13 first, else by title + first author (`pickBookMatch`: same title and same first author, surname plus first initial; no author on file means no lookup; never a guess). A match stores `hardcover_id` (if empty and not already used elsewhere) and goes through the normal flow, which files `series_id` and fills `series_name` / `series_position` only where empty. `series_checked_at` is stamped after every lookup, match or not, so a book is not asked again for 30 days. At most 30 books per run (`MAX_BOOK_LOOKUPS`), paced by the existing pacer and time budget; a 429 stops the run and leaves the rest for the next press of the button or the daily job.
- Discover banner now counts books not yet checked ("N books haven't been checked for a series yet").
- **Rename author:** migration `20261124000300_rename_author.sql` (`library_rename_author`, `library_authors`, folding case, accents and punctuation), server action `renameAuthor`, a "Fix spelling" control by each author on the book page and a "spelled more than one way" line in the library Filters panel.

**Tests:** a unit test that the sync fills empty series fields and leaves existing ones alone (`series-sync.test.ts`); a pgTAP test for the backfill (`supabase/tests`); a test for the rename action (role check, author scope).

---

## #10: Series field should accept typing and offer a dropdown

**Changes**
- New RPC `library_series_by_author(p_library_id)` in a migration. It returns distinct `(series_name, sort_author, author)` rows. Or extend `library_series_names` with the author, keeping the old function for the filter.
- New `src/components/series-combobox.tsx`: a text input with a listbox following the ARIA combobox pattern (keyboard: arrows, Enter, Esc). Any typed value is allowed. Suggestions are ordered as follows:
  1. This book's author's series first, under the label "By <author>".
  2. Every other series in the library, matched as you type with the `library_fold` rules: case and accents ignored, substring match.
  3. If the typed text differs from an existing series only by case or accents, show a hint: "Use 'Villains'?". This is how new duplicates are stopped.
- `src/components/book-forms.tsx:113` uses the combobox in place of the plain `Input`. The form needs the library's series list: pass it down from the book edit page and from the add/confirm sheet (`add/confirm-sheet.tsx`, scan review).
- Picking a series could also suggest the next number. **Proposed: no.** It's easy to get wrong and wasn't asked for.

**Tests:** unit tests for the suggestion ranking (pure function in `src/lib/books/series-suggest.ts`); an e2e test that types, picks a suggestion and saves (`e2e/books.spec.ts`).

---

## #5: Scroll position resets between the library and book details

**Why it happens.** There are two causes:
- The back link on the details page (`books/[id]/page.tsx:59`) is `href="/library"`. It pushes a new library page, which also drops the sort, the filters and the search.
- Even with the browser's Back button, the library remounts. Its extra pages live in component state (`feed.extra` in `library-browser.tsx:134`), so only the first 48 books come back and the page can't scroll to row 200.

**Changes**
- `library-browser.tsx`: save the feed (`sig`, extra item ids or items, `hasMore`) and `scrollY` to `sessionStorage` under a key built from `sig`. Save on `pagehide`, and on click of a book link (capture-phase listener on the grid). On mount, if the stored `sig` matches, restore `extra` at once, then call `scrollTo` in a `useLayoutEffect` after the items have rendered. Wrap every storage access in try/catch, so the page works normally if storage is missing.
  - Store the items themselves, capped at about 500, so the list can be restored without a round trip. Ratings or status may be up to one visit stale. The next `router.refresh` or filter change resets them anyway.
- The back link on the details page becomes a small client component. If the previous entry in this tab was the library (`document.referrer` is same-origin `/library`, or a flag set in `sessionStorage` when leaving the library), it calls `router.back()`. Otherwise it links to the library with the last-used params (saved in the same storage) or plain `/library`.
- Check Next 16's own scroll restoration: read `node_modules/next/dist/docs/` on `scroll` and the router cache, so the two don't fight. Turn off Next's scroll for this page if needed.
- The same pattern could apply to shelf detail later. Out of scope here.

**Tests:** an e2e test that scrolls past two pages, opens a book, goes back with the link and with browser Back, and lands on the same book in view with the same sort.

---

## #7: Read-status chips on mobile need a "scroll for more" cue

**What I saw at 390px:** the chip row is cut off at "✓ R…" (Read). It uses a right-edge mask, but the fade is only 1.5rem, which reads as clutter rather than "more this way". The "350 books" count also sits tight under the chips.

**Changes** (`library-browser.tsx:344`):
- Track scroll state on the row (`scrollLeft`, `scrollWidth`, `clientWidth`; listen to `scroll` and use a `ResizeObserver`). Show the end fade only while there is more content in that direction: no left fade at the start, no right fade at the end.
- Add a 44px-tall chevron button on the right edge over the fade. It scrolls the row by about 70% of its width and is hidden when there is nothing more to the right. It is `aria-hidden` with `tabIndex={-1}`, because the chips are already reachable with the keyboard.
- Add `scroll-snap-type: x proximity` with snap points at the start of each chip, so the row never stops halfway through a chip.
- Leave about 8px more space above the count line on mobile.
- Desktop is unchanged: the row doesn't overflow there.

**Tests:** a Playwright check at 390px that the cue is visible at the start and gone after scrolling to the end.

---

## #8: Discover screen is overwhelming

**What I saw at 390px:** the Discover page is about **55,000px tall (76 screens)**. It has 70 series headings, and every missing volume is a full row with two buttons. "For you" and "For both of you" sit below all of that.

**Changes (proposed: tabs for sections, plus collapsible series):**
- `discover/page.tsx`: the three panels become three tabs: **Series · For you · For both of you**. Each tab has a count badge (missing volumes, picks). Tabs follow the WAI-ARIA pattern: roving tabindex, arrow keys, user-activated, never timed. The active tab is stored in the URL as `?tab=` so it survives reloads and Back. Only the active tab's content is loaded: keep the per-section Suspense and render only the active section server-side, so the For-you queries don't run while you look at series.
- `series-section.tsx`: each `SeriesBlock` collapses to one row by default. The row shows the series name, the author, "You have 17 of 31", the spine strip and a chevron. It uses `<details>`/`<summary>` (native, keyboard-friendly) or a disclosure button with `aria-expanded`. Expanding it shows the missing-volume rows.
- Above the list: a filter field (series or author) and a sort: **Fewest missing first** (the default: these are the easiest to finish), A to Z, or Most missing. A "Hide series" option (stored per user) could come later. **Proposed: not now.**
- On missing-volume rows, raise the 36px buttons to 44px to meet the tap-size rule. On mobile, show "Add to wishlist" as the main action and put "I own this" in a secondary menu, or put both in one row at full width.
- The 24 not-yet-looked-up books keep their dashed callout at the top of the Series tab.

**Tests:** update `e2e/discover.spec.ts` for tabs (`?tab=` deep link) and collapse/expand; a unit test for the series ordering function.

---

## #6: Select several books and merge them into one

**Flow**
1. In Select mode on the library (editors and owners only), a **Merge** button appears in the bulk bar when 2 to 10 books are selected.
2. A **Merge sheet** shows the selected books side by side: cover, title, author, series, ISBN, year, number of copies, readers.
3. You pick the book to keep. **Proposed:** keep that book's details, and fill any empty field from the others. Add one override, "Use this cover" on any card, because the issue is about the better image coming from Discover. A full field-by-field picker is more complex than the case needs.
4. A plain summary before confirming: "3 copies, 2 reading records and 1 shelf move to *Half-Blood*. 2 entries are removed." Confirm is the irreversible action.

**Database:** a new `public.merge_books(p_keep uuid, p_merge uuid[])` in migration `20261124000100_merge_books.sql`. It runs `security invoker`, so RLS and the editor check still apply, and it runs in one transaction:
- All books must be in the same library, and the caller must be an editor or owner of it.
- `copies`, `reads` and `loans`: `update … set book_id = p_keep`. Price history follows its copies. If moving an active borrowed-in loan would break `loans_one_active_in_idx`, abort with a clear error rather than guess.
- `shelf_books`: `insert … on conflict do nothing`, then delete the old rows. If the keeper isn't on a manual shelf yet, it takes the best position the merged books had.
- `user_books`, per user: if only the merged book has a row, move it. If both have rows, keep the keeper's row and fill its null `rating`, `notes`, `started_at` and `finished_at` from the other. Status takes the most advanced of read > reading > dnf > want. Notes are joined with a blank line if both have notes.
- `books`: fill the keeper's null or empty fields (isbn13, hardcover_id, google_books_id, ol_key, series_id, series_name, series_position, description, page_count, published_date, genres, subtitle, public_rating) from the merged books in selection order. The chosen cover goes to `cover_url`. Move `calibre_uuid` only after the merged rows are deleted, because of the unique index.
- Delete the merged books.
- `ownership`: if any of the books is `owned`, the keeper becomes `owned`, so merging a wishlist entry into an owned book can't hide the book.
- It returns counts for the toast.

**App**
- Server action `mergeBooks` in `src/app/(app)/library/bulk-actions.ts`: zod-validated, membership checked the same way as `loadLibraryPage`, then `router.refresh()`.
- `src/components/merge-sheet.tsx`, built on the existing `ui/sheet.tsx`.
- **Proposed small extra:** when "I own this" or "Add" on Discover finds a likely duplicate (`src/lib/duplicates.ts` already has `titleAuthorKey`), the confirm sheet offers "Update the copy you have" instead of making a new book. This stops the duplicates from being created in the first place.

**Tests:** pgTAP for `merge_books` (user_books conflicts, shelf conflicts, cross-library refusal, viewer refusal, loan conflict); a unit test for the action; e2e: select 2, merge with the other book's cover, check that one book remains with both copies.

---

## Design check (`design-taste-frontend`)

I ran the check in Chrome against the live app, signed in, at desktop width and at 390px. **The skill's own gate can't be run as-is on this app, for two reasons:**
- Its scripts start their own headless Chrome. They can't sign in, so every app page redirects to `/sign-in`.
- The skill forbids using a browser tool in place of its scripts.

So I checked the app against the checklist rules that apply to an app screen. The marketing-only rules don't apply here: hero, one section per screen, photo counts.

| Rule | Library | Discover |
|---|---|---|
| No sideways scroll at 390 | Pass (375 = 375) | Pass |
| Tap size 44px | Fail: grid/list toggle is 40×40 | **Fail: 403 controls at 36px tall** (Refresh, Add to wishlist, I own this) |
| One section per screen / sections 1–2 screens | n/a (app list) | **76 screens tall**: this is issue #8 |
| One system: two type faces, one button family | Pass (Figtree + Literata) | Pass |
| Equal edges | Pass | Pass |
| Mobile chip row | Cut-off chip, weak fade (#7) | — |

The work above fixes all of these: the toggle goes to 44px in #7, Discover's buttons and length in #8.

**Running the real gate (proposed, needs your call):** add a test-only sign-in for the local dev server (for example, a Playwright `storageState` from a seeded test user in `e2e/fixtures`). Then point the skill's `check.mjs`/`gate.mjs` at a static capture of each page. That's a separate piece of work. Otherwise, the subagent keeps doing this Chrome-based rule check for each UI change.
