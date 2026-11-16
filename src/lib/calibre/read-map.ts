/** Turning Calibre custom columns into reading status and finish dates. Pure. */
import type { Status } from "@/lib/books/constants";
import { parseCalibreDate } from "./parse";
import type { CalibreRow, CustomColumn, ReadChoice, ReadMapping } from "./types";

export const CHOICES: readonly ReadChoice[] = ["read", "reading", "want", "dnf", "ignore"] as const;
export const CHOICE_LABEL: Record<ReadChoice, string> = {
  read: "Read",
  reading: "Reading",
  want: "Want to read",
  dnf: "Did not finish",
  ignore: "Leave blank",
};

/** Cells compare ignoring case, spacing and a trailing full stop. */
export function normalizeValue(v: string | undefined): string {
  return (v ?? "").replace(/\s+/g, " ").trim().toLowerCase().replace(/\.$/, "");
}

const READ = new Set(["true", "yes", "y", "1", "✓", "✔", "✔️", "☑", "x", "read", "finished", "done", "completed", "complete"]);
const IGNORE = new Set(["", "false", "no", "n", "0", "✗", "✘", "unread", "not read", "none", "n/a"]);
const READING = new Set(["reading", "currently reading", "in progress", "started", "now reading"]);
const WANT = new Set(["want", "want to read", "to read", "to-read", "tbr", "wishlist", "wish list", "next"]);
const DNF = new Set(["dnf", "did not finish", "didn't finish", "abandoned", "dropped", "gave up", "stopped"]);

/** What a value should mean unless the person says otherwise. Booleans and "read" words are read; false and blank are ignored. */
export function defaultChoice(key: string): ReadChoice {
  if (READ.has(key)) return "read";
  if (READING.has(key)) return "reading";
  if (WANT.has(key)) return "want";
  if (DNF.has(key)) return "dnf";
  if (IGNORE.has(key)) return "ignore";
  // Anything else (free text, a name) is left for the person to map in the review table.
  return "ignore";
}

export type ValueCount = { key: string; label: string; count: number };

/** Every distinct value of a column with how many rows have it, most common first. Blank cells are counted too. */
export function distinctValues(rows: CalibreRow[], column: string): ValueCount[] {
  const map = new Map<string, ValueCount>();
  for (const row of rows) {
    const raw = row.custom[column] ?? "";
    const key = normalizeValue(raw);
    const hit = map.get(key);
    if (hit) hit.count++;
    else map.set(key, { key, label: key === "" ? "(blank)" : raw.trim(), count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** True when most filled cells in the column are dates, so it is offered as the finished-date column. */
export function looksLikeDateColumn(rows: CalibreRow[], column: string): boolean {
  let filled = 0;
  let dates = 0;
  for (const row of rows) {
    const v = row.custom[column];
    if (!v) continue;
    filled++;
    if (/^\d{4}-\d{2}-\d{2}/.test(v) && parseCalibreDate(v)) dates++;
    if (filled >= 200) break;
  }
  return filled > 0 && dates / filled >= 0.5;
}

/** A first guess for the two pickers, from the column names and what is in them. */
export function suggestColumns(rows: CalibreRow[], columns: CustomColumn[]): { status: string | null; date: string | null } {
  const usable = columns.filter((c) => c.filled > 0);
  const dates = usable.filter((c) => looksLikeDateColumn(rows, c.header));
  const others = usable.filter((c) => !dates.includes(c));
  const byName = (list: CustomColumn[], re: RegExp) => list.find((c) => re.test(c.header))?.header ?? null;
  const status = byName(others, /read|status|finish/i) ?? null;
  const date = byName(dates, /read|finish|done|complet/i) ?? dates[0]?.header ?? null;
  return { status, date };
}

/** A default value map for a status column: the suggested choice for each distinct value. */
export function defaultValueMap(values: ValueCount[]): Record<string, ReadChoice> {
  const map: Record<string, ReadChoice> = {};
  for (const v of values) map[v.key] = defaultChoice(v.key);
  return map;
}

const THIS_YEAR = () => new Date().getUTCFullYear();

/** A finish date from a custom cell as YYYY-MM-DD. Year-only, undefined and out-of-range dates give null. */
export function parseReadDate(raw: string | undefined): string | null {
  const d = parseCalibreDate(raw);
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const year = Number(d.slice(0, 4));
  return year >= 1900 && year <= THIS_YEAR() + 1 ? d : null;
}

export type ReadOutcome = { status: Status | null; finishedAt: string | null };

/**
 * The importing user's status and finish date for a row.
 * - A status column maps through valueMap (unmapped values count as "ignore").
 * - With no status column, a finish date alone means the book was read.
 * - The date is only used when the status ends up "read"; started_at is never set.
 */
export function applyMapping(row: CalibreRow, mapping: ReadMapping): ReadOutcome {
  let status: Status | null = null;
  if (mapping.statusColumn) {
    const key = normalizeValue(row.custom[mapping.statusColumn]);
    const choice = mapping.valueMap[key] ?? "ignore";
    status = choice === "ignore" ? null : choice;
  }
  const finishedAt = mapping.dateColumn ? parseReadDate(row.custom[mapping.dateColumn]) : null;
  if (!mapping.statusColumn && finishedAt) status = "read";
  return { status, finishedAt: status === "read" ? finishedAt : null };
}
