/**
 * Calibre catalog CSV parser. Pure and isomorphic: it runs in a Web Worker in the browser and directly in tests.
 *
 * The format is Calibre's own `CSV_XML` catalog plugin (src/calibre/library/catalogs/csv_xml.py):
 * UTF-8 with a BOM, comma separated, an unquoted header row, every value quoted with "" for quotes, "" for a missing value,
 * newlines inside a value replaced by spaces, comments converted from HTML to markdown text. Because users also re-save the
 * file in Excel or edit it by hand, the parser accepts anything a CSV library can read, not just Calibre's exact output.
 */
import Papa from "papaparse";
import { toIsbn13 } from "@/lib/isbn";
import { stripHtml } from "@/lib/metadata/html";
import type { CalibreRow, CustomColumn, ParsedCatalog } from "./types";

/** Canonical column -> header spellings accepted (compared lowercase). */
const ALIASES: Record<string, string[]> = {
  title: ["title"],
  authors: ["authors", "author", "author(s)"],
  series: ["series"],
  series_index: ["series_index", "series index", "seriesindex"],
  isbn: ["isbn"],
  identifiers: ["identifiers"],
  comments: ["comments", "description"],
  pubdate: ["pubdate", "published", "publication date"],
  publisher: ["publisher"],
  languages: ["languages", "language"],
  formats: ["formats", "format"],
  uuid: ["uuid"],
};

const MAX_TITLE = 300;
const MAX_DESCRIPTION = 10000;

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Calibre joins authors with " & " and writes a literal ampersand as "&&". */
export function splitAuthors(raw: string): string[] {
  const text = raw.replace(/&&/g, "\u0000");
  const out: string[] = [];
  for (const part of text.split(/\s+&\s+/)) {
    const name = clean(part.replace(/\u0000/g, "&"));
    // Calibre fills "Unknown" in when a book has no author.
    if (name && name.toLowerCase() !== "unknown" && !out.some((a) => a.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

/**
 * `identifiers` is "isbn:978...,goodreads:123,mobi-asin:B00..." (comma joined, `key:value`). A comma inside a value is
 * tolerated: a piece only starts a new identifier when it looks like `key:`.
 */
export function parseIdentifiers(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pieces = raw.split(/,\s*(?=[A-Za-z0-9_.-]+:)/);
  for (const piece of pieces) {
    const at = piece.indexOf(":");
    if (at <= 0) continue;
    const key = piece.slice(0, at).trim().toLowerCase();
    const value = piece.slice(at + 1).trim();
    if (key && value && !(key in out)) out[key] = value;
  }
  return out;
}

/** Numeric series position. Calibre writes Python floats ("1.0", "2.5"); 0, negatives and junk mean "none". */
export function parseSeriesIndex(raw: string | undefined): number | null {
  const s = clean(raw).replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > 10000) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Calibre writes dates with isoformat(), e.g. "2019-03-04T00:00:00+01:00". Its "undefined date" is year 101 ("0101-01-01").
 * Returns YYYY-MM-DD (or YYYY / YYYY-MM when that is all the cell has), or null when there is no usable date.
 */
export function parseCalibreDate(raw: string | undefined): string | null {
  const s = clean(raw);
  if (s === "") return null;
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?![\d])/.exec(s);
  if (m) {
    const year = Number(m[1]);
    if (year < 1000) return null;
    if (m[3]) return `${m[1]}-${m[2]}-${m[3]}`;
    return m[2] ? `${m[1]}-${m[2]}` : m[1];
  }
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  if (d.getUTCFullYear() < 1000) return null;
  return d.toISOString().slice(0, 10);
}

/** Calibre turns comments into markdown with html2text; raw HTML can still appear. Both end up as plain text. */
export function cleanDescription(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  if (s === "") return null;
  let text = stripHtml(s) ?? "";
  text = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\\([*_#\[\]()>`-])/g, "$1")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (text === "") return null;
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1)}…` : text;
}

function splitList(raw: string | undefined, sep: RegExp): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of clean(raw).split(sep)) {
    const v = part.trim().toLowerCase();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Maps canonical column name -> index in the header row. */
function indexColumns(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = h.trim().toLowerCase();
    for (const [canonical, names] of Object.entries(ALIASES)) {
      if (names.includes(key) && !map.has(canonical)) map.set(canonical, i);
    }
  });
  return map;
}

export function normalizeRow(cells: string[], cols: Map<string, number>, customAt: [string, number][], n: number): CalibreRow {
  const cell = (name: string) => {
    const i = cols.get(name);
    return i === undefined ? "" : (cells[i] ?? "");
  };
  const notes: string[] = [];

  const title = clean(cell("title")).slice(0, MAX_TITLE);
  const authors = splitAuthors(cell("authors"));
  const series = clean(cell("series")) || null;
  const seriesPosition = series ? parseSeriesIndex(cell("series_index")) : null;

  const identifiers = parseIdentifiers(cell("identifiers"));
  const rawIsbn = clean(cell("isbn"));
  let isbn13 = rawIsbn ? toIsbn13(rawIsbn) : null;
  if (rawIsbn && !isbn13) notes.push(`The ISBN "${rawIsbn}" is not valid, so it was ignored.`);
  if (!isbn13 && identifiers.isbn) {
    isbn13 = toIsbn13(identifiers.isbn);
    if (!isbn13 && !rawIsbn) notes.push(`The ISBN "${identifiers.isbn}" in identifiers is not valid, so it was ignored.`);
  }
  delete identifiers.isbn;

  const pubRaw = cell("pubdate");
  const publishedDate = parseCalibreDate(pubRaw);

  const custom: Record<string, string> = {};
  for (const [header, i] of customAt) {
    const v = clean(cells[i]);
    if (v !== "") custom[header] = v;
  }

  const uuid = clean(cell("uuid")).toLowerCase().slice(0, 100) || null;

  return {
    n,
    title,
    authors,
    series,
    seriesPosition,
    isbn13,
    identifiers,
    description: cleanDescription(cell("comments")),
    publishedDate,
    publisher: clean(cell("publisher")) || null,
    languages: splitList(cell("languages"), /[,;]/),
    formats: splitList(cell("formats"), /[,;]/).map((f) => f.replace(/^\./, "")),
    calibreUuid: uuid,
    custom,
    error: title === "" ? "This row has no title." : null,
    notes,
  };
}

export type ParseOptions = {
  /** Called as rows are normalized, with a 0 to 1 fraction. */
  onProgress?: (fraction: number) => void;
  /** Awaited between chunks so a long file never blocks the thread it runs on. */
  yieldFn?: () => Promise<void>;
  chunk?: number;
};

const defaultYield = () => new Promise<void>((r) => setTimeout(r, 0));

/** Parses a catalog CSV. Row problems land on the row; only an unusable file sets `fatal`. */
export async function parseCalibreCsv(text: string, opts: ParseOptions = {}): Promise<ParsedCatalog> {
  const chunk = opts.chunk ?? 500;
  const yieldFn = opts.yieldFn ?? defaultYield;
  const empty = (fatal: string): ParsedCatalog => ({ rows: [], headers: [], recognized: [], customColumns: [], fatal });

  const body = stripBom(text);
  if (body.trim() === "") return empty("That file is empty.");

  const result = Papa.parse<string[]>(body, {
    header: false,
    skipEmptyLines: "greedy",
    delimitersToGuess: [",", ";", "\t"],
  });
  const table = result.data;
  if (table.length === 0) return empty("That file is empty.");

  const headers = table[0].map((h) => h.replace(/^﻿/, "").trim());
  const cols = indexColumns(headers);
  if (!cols.has("title")) {
    return {
      ...empty("This file has no title column. In Calibre, tick title in the field list before saving the catalog."),
      headers,
    };
  }

  const customAt: [string, number][] = [];
  headers.forEach((h, i) => {
    if (h.startsWith("#") && h.length > 1) customAt.push([h, i]);
  });

  const rows: CalibreRow[] = [];
  const total = table.length - 1;
  for (let start = 1; start < table.length; start += chunk) {
    const end = Math.min(start + chunk, table.length);
    for (let r = start; r < end; r++) rows.push(normalizeRow(table[r], cols, customAt, r));
    opts.onProgress?.(total === 0 ? 1 : (end - 1) / total);
    if (end < table.length) await yieldFn();
  }

  // A uuid is one book. Later copies of the same uuid in this file are flagged, the first stays.
  const firstByUuid = new Map<string, number>();
  for (const row of rows) {
    if (!row.calibreUuid) continue;
    const seen = firstByUuid.get(row.calibreUuid);
    if (seen === undefined) firstByUuid.set(row.calibreUuid, row.n);
    else if (!row.error) row.error = `Repeats the Calibre id of row ${seen}.`;
  }

  const customColumns: CustomColumn[] = customAt.map(([header]) => ({
    header,
    filled: rows.reduce((n, r) => n + (r.custom[header] ? 1 : 0), 0),
  }));

  return {
    rows,
    headers,
    recognized: [...cols.keys()],
    customColumns,
    fatal: null,
  };
}
