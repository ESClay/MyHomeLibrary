/** One author spelling as it appears in the library, with the number of books that list it. */
export type AuthorCount = { name: string; books: number };

/** A person written more than one way: every spelling found, the most used first. */
export type AuthorVariantGroup = { key: string; spellings: AuthorCount[] };

/**
 * The comparison form of an author's name: accents, case, punctuation and spacing are ignored, so "Gail Z Martin" and
 * "Gail Z. Martin" are the same person. The same folding the database does in `library_fold_name`.
 */
export function foldAuthor(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Groups spellings of the same author; only groups with two or more different spellings are returned, sorted by name. */
export function findAuthorVariants(authors: readonly AuthorCount[]): AuthorVariantGroup[] {
  const groups = new Map<string, Map<string, number>>();
  for (const a of authors) {
    const name = a.name.trim();
    const key = foldAuthor(name);
    if (!key) continue;
    const g = groups.get(key) ?? new Map<string, number>();
    g.set(name, (g.get(name) ?? 0) + a.books);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .filter(([, g]) => g.size > 1)
    .map(([key, g]) => ({
      key,
      spellings: [...g.entries()].map(([name, books]) => ({ name, books })).sort((x, y) => y.books - x.books || x.name.localeCompare(y.name)),
    }))
    .sort((x, y) => x.spellings[0].name.localeCompare(y.spellings[0].name));
}

/** The other spellings of `name` found in the library (not `name` itself). */
export function otherSpellings(name: string, groups: readonly AuthorVariantGroup[]): AuthorCount[] {
  const key = foldAuthor(name);
  const g = groups.find((x) => x.key === key);
  return g ? g.spellings.filter((s) => s.name !== name.trim()) : [];
}
