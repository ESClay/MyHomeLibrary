/** Pure helpers that shape the stats RPC rows into chart-ready series. No I/O, so each is tested on its own. */

export type Who = "me" | "partner" | "both";
export type Person = { id: string; name: string; isMe: boolean };

/** A line or bar series: one person, or all the other members together. Colour follows the entity, never its rank. */
export type PersonSeries = { key: "me" | "partner"; label: string; userIds: string[] };

export type ReadingRow = { userId: string; month: string; books: number; pages: number };
export type RatingRow = { userId: string; halfStars: number; books: number };
export type AddedRow = { month: string; ownership: "owned" | "wishlist" | "borrowed"; books: number };
export type UnreadRow = { userId: string; owned: number; read: number; reading: number; unread: number };

/** Who the toggle can offer: nothing to choose between when there is only one member. */
export function whoOptions(people: Person[]): { who: Who; label: string }[] {
  const others = people.filter((p) => !p.isMe);
  if (others.length === 0) return [{ who: "me", label: "You" }];
  const partner = others.length === 1 ? others[0].name : "Others";
  return [
    { who: "me", label: "You" },
    { who: "partner", label: partner },
    { who: "both", label: "Both" },
  ];
}

/** The series a toggle value shows. With one member every value falls back to "me". */
export function seriesFor(who: Who, people: Person[]): PersonSeries[] {
  const me = people.find((p) => p.isMe);
  const others = people.filter((p) => !p.isMe);
  const mine: PersonSeries = { key: "me", label: me ? "You" : "Me", userIds: me ? [me.id] : [] };
  if (others.length === 0) return [mine];
  const partner: PersonSeries = { key: "partner", label: others.length === 1 ? others[0].name : "Others", userIds: others.map((o) => o.id) };
  if (who === "me") return [mine];
  if (who === "partner") return [partner];
  return [mine, partner];
}

const yearOf = (month: string) => Number(month.slice(0, 4));
const monthIndex = (month: string) => Number(month.slice(5, 7)) - 1;

export type Metric = "books" | "pages";

/** Every year from the first to the last with a read, zero-filled, one value per series. */
export function readingByYear(rows: ReadingRow[], series: PersonSeries[], metric: Metric): { years: number[]; values: number[][] } {
  const relevant = rows.filter((r) => series.some((s) => s.userIds.includes(r.userId)));
  if (relevant.length === 0) return { years: [], values: series.map(() => []) };
  const years0 = relevant.map((r) => yearOf(r.month));
  const first = Math.min(...years0);
  const last = Math.max(...years0);
  const years = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const values = series.map((s) => years.map((y) => relevant.filter((r) => s.userIds.includes(r.userId) && yearOf(r.month) === y).reduce((a, r) => a + r[metric], 0)));
  return { years, values };
}

/** The twelve months of one year, zero-filled. */
export function readingByMonth(rows: ReadingRow[], series: PersonSeries[], year: number, metric: Metric): number[][] {
  return series.map((s) => {
    const out = Array<number>(12).fill(0);
    for (const r of rows) if (s.userIds.includes(r.userId) && yearOf(r.month) === year) out[monthIndex(r.month)] += r[metric];
    return out;
  });
}

/** Years that have reads for these series, newest first (for the year picker). */
export function yearsWithReads(rows: ReadingRow[], series: PersonSeries[]): number[] {
  return [...new Set(rows.filter((r) => series.some((s) => s.userIds.includes(r.userId))).map((r) => yearOf(r.month)))].sort((a, b) => b - a);
}

export function readingTotals(rows: ReadingRow[], series: PersonSeries[]): { books: number; pages: number } {
  let books = 0;
  let pages = 0;
  for (const r of rows) {
    if (!series.some((s) => s.userIds.includes(r.userId))) continue;
    books += r.books;
    pages += r.pages;
  }
  return { books, pages };
}

/** Ten half-star buckets (0.5 .. 5) per series. */
export function ratingDistribution(rows: RatingRow[], series: PersonSeries[]): number[][] {
  return series.map((s) => {
    const out = Array<number>(10).fill(0);
    for (const r of rows) if (s.userIds.includes(r.userId) && r.halfStars >= 1 && r.halfStars <= 10) out[r.halfStars - 1] += r.books;
    return out;
  });
}

/** The last `count` months ending at `now`, as `YYYY-MM-01` strings, oldest first. */
export function lastMonths(now: Date, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Books added per month over the last `count` months, zero-filled, plus how many came before that window. */
export function addedByMonth(rows: AddedRow[], now: Date, count: number): { months: string[]; added: number[]; before: number } {
  const months = lastMonths(now, count);
  const idx = new Map(months.map((m, i) => [m, i]));
  const added = Array<number>(count).fill(0);
  let before = 0;
  for (const r of rows) {
    if (r.ownership === "borrowed") continue;
    const key = `${r.month.slice(0, 7)}-01`;
    const i = idx.get(key);
    if (i !== undefined) added[i] += r.books;
    else if (key < months[0]) before += r.books;
  }
  return { months, added, before };
}

export function ownershipTotals(rows: AddedRow[]): { owned: number; wishlist: number; borrowed: number } {
  const t = { owned: 0, wishlist: 0, borrowed: 0 };
  for (const r of rows) t[r.ownership] += r.books;
  return t;
}

/** Owned books each series has not read, with how many they have read. A series is the sum over its users. */
export function unreadBySeries(rows: UnreadRow[], series: PersonSeries[]): { key: PersonSeries["key"]; label: string; owned: number; read: number; unread: number }[] {
  return series.map((s) => {
    const mine = rows.filter((r) => s.userIds.includes(r.userId));
    // Several "others" each own the same books: show the average rather than a sum that double counts.
    const n = Math.max(1, mine.length);
    const avg = (f: (r: UnreadRow) => number) => Math.round(mine.reduce((a, r) => a + f(r), 0) / n);
    return { key: s.key, label: s.label, owned: avg((r) => r.owned), read: avg((r) => r.read), unread: avg((r) => r.unread) };
  });
}

export type ValueRow = { copies: number; priced: number; unpriced: number; otherCurrency: number; estValue: number; paid: number; paidPriced: number };

/** The headline numbers for library value. The difference compares like with like: the paid price of only the copies that have a market price. */
export function valueSummary(v: ValueRow): { diff: number | null; diffPct: number | null; coverage: number } {
  const diff = v.priced > 0 ? Math.round((v.estValue - v.paidPriced) * 100) / 100 : null;
  const diffPct = diff !== null && v.paidPriced > 0 ? Math.round((diff / v.paidPriced) * 1000) / 10 : null;
  return { diff, diffPct, coverage: v.copies > 0 ? v.priced / v.copies : 0 };
}

/** Round, even axis ticks from 0 up to just above `max`. */
export function niceTicks(max: number, target = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / target;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const unit = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((u) => u >= rough) ?? 10 * pow;
  const top = Math.ceil(max / unit) * unit;
  const ticks: number[] = [];
  for (let t = 0; t <= top + unit / 1000; t += unit) ticks.push(Math.round(t * 1e6) / 1e6);
  return ticks;
}
