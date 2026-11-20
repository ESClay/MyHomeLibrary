/** One series name with the first author of a book that carries it. A series can appear once per author. */
export type SeriesOption = { name: string; author: string };

export type SeriesSuggestions = {
  /** The existing spelling to offer when the typed text differs from it only by case or accents. */
  hint: string | null;
  /** This book's author's series matching the typed text. */
  byAuthor: string[];
  /** Every other series in the library matching the typed text. */
  others: string[];
};

/** Case- and accent-insensitive form, the same idea as the database's `library_fold`. */
export function foldSeries(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const MAX_OTHERS = 30;

/** Rank the library's series for what has been typed: the author's own first, then the rest, plus a near-duplicate hint. */
export function suggestSeries(typed: string, author: string, options: readonly SeriesOption[]): SeriesSuggestions {
  const t = foldSeries(typed);
  const a = foldSeries(author);
  const byAuthor: string[] = [];
  const others: string[] = [];
  const seen = new Set<string>();
  let hint: string | null = null;

  // Collect names once each, the author's own series winning over the same name under another author.
  const names = new Map<string, { name: string; mine: boolean }>();
  for (const o of options) {
    const key = o.name;
    const mine = a !== "" && foldSeries(o.author) === a;
    const prev = names.get(key);
    if (!prev || (mine && !prev.mine)) names.set(key, { name: o.name, mine });
  }
  const sorted = [...names.values()].sort((x, y) => x.name.localeCompare(y.name, "en", { sensitivity: "base" }));

  for (const { name, mine } of sorted) {
    const f = foldSeries(name);
    if (t && f === t && name !== typed.trim() && hint === null) hint = name;
    if (t && !f.includes(t)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    if (mine) byAuthor.push(name);
    else if (others.length < MAX_OTHERS) others.push(name);
  }
  return { hint, byAuthor, others };
}
