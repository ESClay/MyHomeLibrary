export type ProviderName = "hardcover" | "google" | "openlibrary";

export type CoverCandidate = { url: string; source: ProviderName };

export type PublicRating = { value: number; count: number | null; source: ProviderName };

/** One book, normalized across providers. */
export type BookMetadata = {
  title: string;
  subtitle: string | null;
  authors: string[];
  seriesName: string | null;
  seriesPosition: number | null;
  description: string | null;
  covers: CoverCandidate[];
  pageCount: number | null;
  /** As the provider gives it: YYYY, YYYY-MM or YYYY-MM-DD, or free text. */
  publishedDate: string | null;
  genres: string[];
  isbn13: string | null;
  isbn10: string | null;
  ids: { hardcover?: number; google?: string; openLibrary?: string };
  rating: PublicRating | null;
  /** Providers that contributed to this record, in priority order. */
  providers: ProviderName[];
};

export type MetadataProvider = {
  name: ProviderName;
  /** False when the provider needs a key that is not set. It is then skipped. */
  isConfigured(): boolean;
  lookupByIsbn(isbn13: string): Promise<BookMetadata | null>;
  search(query: string): Promise<BookMetadata[]>;
};
