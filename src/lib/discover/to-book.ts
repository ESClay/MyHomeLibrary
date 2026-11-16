/** Conversions between catalogue records, series entries and the add-book action's input. Pure and client-safe. */
import type { CreateBookInput } from "@/lib/books/schemas";
import type { BookMetadata } from "@/lib/metadata/types";
import type { GapEntry } from "./gaps";

/** A series entry as a catalogue record, for the confirm sheet and for adding it to the library. */
export function entryToMetadata(entry: GapEntry, seriesName: string): BookMetadata {
  return {
    title: entry.title,
    subtitle: null,
    authors: entry.authors,
    seriesName,
    seriesPosition: entry.position,
    description: null,
    covers: entry.coverUrl ? [{ url: entry.coverUrl, source: "hardcover" }] : [],
    pageCount: null,
    publishedDate: entry.releaseDate,
    genres: [],
    isbn13: entry.isbn13,
    isbn10: null,
    ids: entry.hardcoverBookId ? { hardcover: entry.hardcoverBookId } : {},
    rating: null,
    providers: ["hardcover"],
  };
}

/** The createBook input for a catalogue record. Owned books get one paperback copy the person can edit later. */
export function createInputFromMetadata(
  libraryId: string,
  m: BookMetadata,
  opts: { ownership: "owned" | "wishlist"; myStatus?: "want" | "reading" | "read" | "dnf" },
): CreateBookInput {
  return {
    libraryId,
    book: {
      title: m.title,
      subtitle: m.subtitle,
      authors: m.authors,
      seriesName: m.seriesName,
      seriesPosition: m.seriesPosition,
      description: m.description,
      coverUrl: m.covers[0]?.url ?? null,
      pageCount: m.pageCount,
      publishedDate: m.publishedDate,
      genres: m.genres,
      isbn13: m.isbn13,
      ownership: opts.ownership,
    },
    provider: {
      hardcoverId: m.ids.hardcover ?? null,
      googleBooksId: m.ids.google ?? null,
      olKey: m.ids.openLibrary ?? null,
      publicRating: m.rating?.value ?? null,
      publicRatingCount: m.rating?.count ?? null,
      ratingSource: m.rating?.source ?? null,
    },
    copy: opts.ownership === "owned" ? { format: "paperback" } : null,
    myStatus: opts.ownership === "wishlist" ? "want" : (opts.myStatus ?? null),
  };
}
