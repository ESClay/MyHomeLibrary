/** Duplicate detection for the add flow. Pure functions, shared by server and client. */

const ARTICLES = new Set(["the", "a", "an"]);

function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Lowercase, accent-free, punctuation-free title without a leading article. */
export function normalizeTitle(title: string): string {
  const words = fold(title).split(" ").filter(Boolean);
  if (words.length > 1 && ARTICLES.has(words[0])) words.shift();
  return words.join(" ");
}

/** Surname of an author, handling "Last, First" and "First Middle Last". */
export function authorSurname(author: string | undefined): string {
  if (!author) return "";
  const comma = author.indexOf(",");
  const surname = comma > 0 ? author.slice(0, comma) : author;
  const words = fold(surname).split(" ").filter(Boolean);
  return words[words.length - 1] ?? "";
}

/** title + first author key used for the fallback duplicate match. */
export function titleAuthorKey(title: string, authors: string[]): string {
  return `${normalizeTitle(title)}|${authorSurname(authors[0])}`;
}

export type ExistingBook = {
  id: string;
  title: string;
  authors: string[];
  isbn13: string | null;
  /** edition_isbn of every copy of the book */
  copyIsbns: string[];
  coverUrl?: string | null;
};

export type DuplicateCandidate = {
  title: string;
  authors: string[];
  isbn13: string | null;
};

export type DuplicateMatch = { book: ExistingBook; reason: "isbn" | "title" };

/**
 * Matches by ISBN-13 first (books.isbn13 or any copy's edition_isbn), then by
 * normalized title + first author's surname. ISBN matches come first in the result.
 */
export function findDuplicates(candidate: DuplicateCandidate, existing: ExistingBook[]): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  const seen = new Set<string>();

  if (candidate.isbn13) {
    for (const b of existing) {
      if (b.isbn13 === candidate.isbn13 || b.copyIsbns.includes(candidate.isbn13)) {
        matches.push({ book: b, reason: "isbn" });
        seen.add(b.id);
      }
    }
  }

  const key = titleAuthorKey(candidate.title, candidate.authors);
  const [titlePart] = key.split("|");
  if (titlePart) {
    for (const b of existing) {
      if (seen.has(b.id)) continue;
      if (titleAuthorKey(b.title, b.authors) === key) matches.push({ book: b, reason: "title" });
    }
  }
  return matches;
}
