/** Pure rules and wording for merging books, kept apart from the action and the sheet so they can be tested alone. */

export const MIN_MERGE_BOOKS = 2;
export const MAX_MERGE_BOOKS = 10;

/** What the merge sheet shows about one selected book. */
export type MergeBook = {
  id: string;
  title: string;
  authors: string[];
  seriesName: string | null;
  seriesPosition: number | null;
  isbn13: string | null;
  publishedDate: string | null;
  coverUrl: string | null;
  copies: number;
  /** My-status rows (one per person) plus dated re-reads. */
  readingRecords: number;
};

export type MergeCounts = {
  copies: number;
  reads: number;
  loans: number;
  shelves: number;
  readingRecords: number;
  removed: number;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The cover to preselect: the kept book's own, else the first selected book that has one, else none. */
export function defaultCoverFrom(books: MergeBook[], keepId: string): string | null {
  const keeper = books.find((b) => b.id === keepId);
  if (keeper?.coverUrl) return keeper.id;
  return books.find((b) => b.coverUrl)?.id ?? null;
}

/** A plain account of what Confirm does, before the irreversible step. */
export function mergeSummary(books: MergeBook[], keepId: string): string {
  const keeper = books.find((b) => b.id === keepId);
  const others = books.filter((b) => b.id !== keepId);
  const copies = others.reduce((n, b) => n + b.copies, 0);
  const records = others.reduce((n, b) => n + b.readingRecords, 0);
  const moving = [copies > 0 && plural(copies, "copy", "copies"), records > 0 && plural(records, "reading record")].filter(Boolean) as string[];
  const title = keeper?.title ?? "the book you keep";
  const move = moving.length ? `${moving.join(" and ")} ${moving.length === 1 && copies + records === 1 ? "moves" : "move"} to ${title}. ` : "";
  const removed = plural(others.length, "entry", "entries");
  return `${move}${removed} ${others.length === 1 ? "is" : "are"} removed. This can't be undone.`;
}

/** The toast after a merge. */
export function mergeResultMessage(keeperTitle: string, c: MergeCounts): string {
  return `Merged ${plural(c.removed + 1, "book")} into ${keeperTitle}.`;
}

/** Normalises the RPC's jsonb into MergeCounts. */
export function parseMergeCounts(raw: unknown): MergeCounts | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const n = (k: string) => (typeof o[k] === "number" ? (o[k] as number) : 0);
  return { copies: n("copies"), reads: n("reads"), loans: n("loans"), shelves: n("shelves"), readingRecords: n("reading_records"), removed: n("removed") };
}

/** Postgres raises plain-English messages from merge_books; show those, hide anything else behind a generic line. */
export function mergeErrorMessage(message: string | undefined): string {
  if (!message) return "Could not merge those books.";
  const known = [
    "More than one of these books is on loan",
    "Only owners and editors",
    "Books from different libraries",
    "Some of those books no longer exist",
    "Merge between",
    "The book to keep",
    "Each book can be listed",
    "The cover must come",
  ];
  return known.some((k) => message.startsWith(k)) ? message : "Could not merge those books.";
}
