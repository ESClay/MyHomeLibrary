/** Shared shapes for the Calibre import. Pure types, safe on client and server. */
import type { Status } from "@/lib/books/constants";

/** One catalog row after normalizing, before any library matching. */
export type CalibreRow = {
  /** 1-based position among the data rows, so messages can say "row 14". */
  n: number;
  title: string;
  authors: string[];
  series: string | null;
  /** Numeric; 2.5 is allowed. Null when there is no series, or Calibre's 0/blank "no position". */
  seriesPosition: number | null;
  /** ISBN-13 from `isbn`, else from `identifiers`. Null when absent or not a valid ISBN. */
  isbn13: string | null;
  /** Every identifier except isbn, e.g. { goodreads: "123" }. */
  identifiers: Record<string, string>;
  /** Plain text, sanitized. */
  description: string | null;
  /** YYYY-MM-DD, or YYYY when Calibre only has the year. Null for Calibre's "undefined" date. */
  publishedDate: string | null;
  publisher: string | null;
  languages: string[];
  /** Lowercase extensions, e.g. ["epub", "mobi"]. */
  formats: string[];
  calibreUuid: string | null;
  /** Raw values of every `#` column, keyed by the header as written. */
  custom: Record<string, string>;
  /** Why the row cannot be imported (no title, repeated uuid). Null when it is usable. */
  error: string | null;
  /** Things that were ignored but do not block the row (an invalid ISBN, an odd date). */
  notes: string[];
};

export type CustomColumn = { header: string; filled: number };

export type ParsedCatalog = {
  rows: CalibreRow[];
  /** Headers exactly as in the file (BOM removed). */
  headers: string[];
  /** Catalog columns this importer understood, as the canonical names. */
  recognized: string[];
  /** `#` columns, with how many rows have a value. */
  customColumns: CustomColumn[];
  /** Set when the file cannot be used at all (no title column, empty). */
  fatal: string | null;
};

export type ReadChoice = Status | "ignore";

/** The importer's choices for read status. Keys of valueMap are normalizeValue() of the cell. */
export type ReadMapping = {
  statusColumn: string | null;
  dateColumn: string | null;
  valueMap: Record<string, ReadChoice>;
};

export const EMPTY_MAPPING: ReadMapping = { statusColumn: null, dateColumn: null, valueMap: {} };

export type RowStatus = "new" | "existing" | "attention";
export type ImportAction = "add" | "copy" | "skip";
