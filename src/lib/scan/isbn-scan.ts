/** Pure scan helpers: what counts as an ISBN barcode, and the repeat-scan window. */
import { isIsbn13 } from "@/lib/isbn";

/** The same code seen again within this window is ignored. */
export const REPEAT_WINDOW_MS = 3000;

export type ScanClass =
  | { kind: "isbn"; isbn: string }
  /** A readable barcode that is not a book: UPC, a store EAN, anything else. */
  | { kind: "other" }
  /** A symbol to skip silently (a lone EAN-2 or EAN-5 price add-on). */
  | { kind: "ignore" };

/** True for a 13-digit code with a 978 or 979 prefix and a valid ISBN-13 checksum. */
export function isIsbnBarcode(code: string): boolean {
  return /^97[89]\d{10}$/.test(code) && isIsbn13(code);
}

/**
 * Classify a decoded barcode. EAN-13 only: an EAN-5/EAN-2 symbol alone is ignored, and a code that arrives
 * with its add-on glued on (13 digits + 2 or 5) is cut back to the 13 digits first.
 */
export function classifyScan(text: string, format?: string): ScanClass {
  if (format === "EAN5" || format === "EAN2") return { kind: "ignore" };
  let code = text.replace(/\s+/g, "");
  if (/^\d{15}$|^\d{18}$/.test(code)) code = code.slice(0, 13);
  return isIsbnBarcode(code) ? { kind: "isbn", isbn: code } : { kind: "other" };
}

/**
 * Remembers when each key was last seen. `check` returns true when the key is new or has not been seen
 * for `windowMs`. Every sighting refreshes the timer, so a book held steadily in view stays quiet.
 */
export class RepeatGuard {
  private seen = new Map<string, number>();
  constructor(private readonly windowMs: number = REPEAT_WINDOW_MS) {}

  check(key: string, now: number): boolean {
    const last = this.seen.get(key);
    this.seen.set(key, now);
    if (this.seen.size > 64) {
      for (const [k, t] of this.seen) if (now - t >= this.windowMs) this.seen.delete(k);
    }
    return last === undefined || now - last >= this.windowMs;
  }

  reset(): void {
    this.seen.clear();
  }
}
