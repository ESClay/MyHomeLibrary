import { toIsbn13, cleanIsbn } from "@/lib/isbn";
import { stripHtml } from "./html";
import type { BookMetadata, CoverCandidate, ProviderName } from "./types";

export function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s === "" ? null : s;
}

export function posInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return uniqueStrings(v.map(str).filter((s): s is string => s !== null));
}

export function uniqueStrings(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    const k = s.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}

export function httpsUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const u = s.startsWith("//") ? `https:${s}` : s.replace(/^http:\/\//i, "https://");
  try {
    const parsed = new URL(u);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function cover(url: unknown, source: ProviderName): CoverCandidate[] {
  const u = httpsUrl(url);
  return u ? [{ url: u, source }] : [];
}

/** A rating on a 0-5 scale, rounded to 2 decimals; zero or missing means "no rating". */
export function rating(value: unknown, count: unknown, source: ProviderName) {
  const v = num(value);
  if (v === null || v <= 0 || v > 5) return null;
  return { value: Math.round(v * 100) / 100, count: posInt(count), source };
}

/** First ISBN-13 found among the given strings (ISBN-10s are converted). */
export function pickIsbns(values: unknown[]): { isbn13: string | null; isbn10: string | null } {
  let isbn13: string | null = null;
  let isbn10: string | null = null;
  for (const raw of values) {
    const s = cleanIsbn(typeof raw === "string" ? raw : "");
    if (!s) continue;
    if (s.length === 13 && !isbn13) isbn13 = toIsbn13(s);
    else if (s.length === 10 && !isbn10 && toIsbn13(s)) isbn10 = s;
  }
  return { isbn13: isbn13 ?? (isbn10 ? toIsbn13(isbn10) : null), isbn10 };
}

export function description(v: unknown): string | null {
  return typeof v === "string" ? stripHtml(v) : null;
}

export function emptyMetadata(provider: ProviderName): BookMetadata {
  return {
    title: "",
    subtitle: null,
    authors: [],
    seriesName: null,
    seriesPosition: null,
    description: null,
    covers: [],
    pageCount: null,
    publishedDate: null,
    genres: [],
    isbn13: null,
    isbn10: null,
    ids: {},
    rating: null,
    providers: [provider],
  };
}
