/** Pure rule for "Update the book you have": fill the existing book's empty fields from freshly looked-up metadata. */

export type FillBook = {
  subtitle: string | null;
  authors: string[];
  series_name: string | null;
  series_position: number | null;
  description: string | null;
  cover_url: string | null;
  page_count: number | null;
  published_date: string | null;
  genres: string[];
  isbn13: string | null;
  hardcover_id: number | null;
  google_books_id: string | null;
  ol_key: string | null;
  public_rating: number | null;
  public_rating_count: number | null;
  rating_source: string | null;
};

export type FillPatch = Partial<FillBook>;

const blank = (v: string | null | undefined) => v == null || v.trim() === "";

/**
 * Returns only the columns that change. Existing values are never overwritten, except the cover when `replaceCover`
 * is set and the new metadata has one. The series name and number travel together, and so do the public rating's value,
 * count and source, so a field never ends up with another source's number.
 */
export function planBookFill(existing: FillBook, incoming: FillPatch, replaceCover: boolean): FillPatch {
  const patch: FillPatch = {};
  const text = (k: "subtitle" | "description" | "published_date" | "isbn13" | "google_books_id" | "ol_key") => {
    if (blank(existing[k]) && !blank(incoming[k])) patch[k] = incoming[k]!.trim();
  };
  text("subtitle");
  text("description");
  text("published_date");
  text("isbn13");
  text("google_books_id");
  text("ol_key");
  if (existing.page_count == null && incoming.page_count != null) patch.page_count = incoming.page_count;
  if (existing.hardcover_id == null && incoming.hardcover_id != null) patch.hardcover_id = incoming.hardcover_id;
  if (existing.authors.length === 0 && (incoming.authors?.length ?? 0) > 0) patch.authors = incoming.authors;
  if (existing.genres.length === 0 && (incoming.genres?.length ?? 0) > 0) patch.genres = incoming.genres;
  if (blank(existing.series_name) && !blank(incoming.series_name)) {
    patch.series_name = incoming.series_name!.trim();
    if (existing.series_position == null && incoming.series_position != null) patch.series_position = incoming.series_position;
  }
  if (existing.public_rating == null && incoming.public_rating != null) {
    patch.public_rating = incoming.public_rating;
    patch.public_rating_count = incoming.public_rating_count ?? null;
    patch.rating_source = incoming.rating_source ?? null;
  }
  if (!blank(incoming.cover_url) && (replaceCover || blank(existing.cover_url))) patch.cover_url = incoming.cover_url!;
  return patch;
}
