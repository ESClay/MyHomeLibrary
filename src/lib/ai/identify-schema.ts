/**
 * What the model is asked to return for a photo of books, and how that answer is checked.
 * Pure: no SDK, no network. The model's output is untrusted, so it is parsed defensively and
 * anything malformed is dropped rather than shown.
 */
import { z } from "zod";
import { toIsbn13 } from "@/lib/isbn";

/** Most books read from one photo. A shelf of spines rarely exceeds this; extras are dropped. */
export const MAX_DETECTED = 60;

export type DetectedBook = {
  title: string;
  authors: string[];
  series: string | null;
  seriesPosition: number | null;
  /** ISBN-13, only when one was printed and passes the checksum. */
  isbn: string | null;
  /** 0 to 1. */
  confidence: number;
  kind: "cover" | "spine";
  /** Left-to-right position in the photo (0 is leftmost); null when the model gave none. */
  index: number | null;
};

/**
 * JSON Schema for `output_config.format`. Every property is required and the optional ones are
 * nullable, which keeps structured-output decoding strict. No numeric bounds: those are not
 * supported by the decoder, so ranges are enforced in `parseModelOutput` instead.
 */
export const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["books"],
  properties: {
    books: {
      type: "array",
      description: "Every distinct book visible in the photo, in left-to-right order.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "authors", "series", "seriesPosition", "isbn", "confidence", "kind", "index"],
        properties: {
          title: { type: "string", description: "The title as printed. Never a guess at a title that is not legible." },
          authors: { type: "array", items: { type: "string" }, description: "Authors as printed; an empty array when none is legible." },
          series: { type: ["string", "null"], description: "Series name only when printed on the book." },
          seriesPosition: { type: ["number", "null"], description: "Volume number only when printed on the book." },
          isbn: { type: ["string", "null"], description: "An ISBN only when it is printed and fully legible; otherwise null." },
          confidence: { type: "number", description: "0 to 1: how sure you are that the title (and author) are read correctly." },
          kind: { type: "string", enum: ["cover", "spine"], description: "Whether the front cover or only the spine is visible." },
          index: { type: ["integer", "null"], description: "Position from the left edge of the photo, starting at 0." },
        },
      },
    },
  },
} as const;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const rawBook = z.object({
  title: z.string(),
  authors: z.array(z.string()).default([]),
  series: z.string().nullish(),
  seriesPosition: z.number().nullish(),
  isbn: z.string().nullish(),
  confidence: z.number(),
  kind: z.enum(["cover", "spine"]).catch("spine"),
  index: z.number().nullish(),
});

const envelope = z.object({ books: z.array(z.unknown()) });

export type ParsedOutput =
  | { ok: true; books: DetectedBook[]; dropped: number }
  | { ok: false; reason: "invalid_json" | "wrong_shape" };

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Validates one raw entry; null when it is unusable (no title, not an object, bad numbers). */
function toDetected(raw: unknown): DetectedBook | null {
  const r = rawBook.safeParse(raw);
  if (!r.success) return null;
  const title = clean(r.data.title).slice(0, 300);
  if (title === "" || !Number.isFinite(r.data.confidence)) return null;
  const authors = r.data.authors.map((a) => clean(a).slice(0, 200)).filter(Boolean).slice(0, 10);
  const series = r.data.series ? clean(r.data.series).slice(0, 200) || null : null;
  const pos = r.data.seriesPosition;
  const index = r.data.index;
  return {
    title,
    authors,
    series,
    seriesPosition: series && typeof pos === "number" && Number.isFinite(pos) && pos >= 0 && pos <= 10000 ? pos : null,
    isbn: toIsbn13(r.data.isbn ?? null),
    confidence: clamp01(r.data.confidence),
    kind: r.data.kind,
    index: typeof index === "number" && Number.isFinite(index) && index >= 0 ? Math.floor(index) : null,
  };
}

/** Shelf order: by the model's left-to-right index; entries without one keep their place after the rest. */
export function orderDetections(books: DetectedBook[]): DetectedBook[] {
  return books
    .map((b, i) => ({ b, i }))
    .sort((x, y) => {
      const xi = x.b.index ?? Number.POSITIVE_INFINITY;
      const yi = y.b.index ?? Number.POSITIVE_INFINITY;
      return xi === yi ? x.i - y.i : xi - yi;
    })
    .map(({ b }) => b);
}

/** Parses the model's text. A good envelope with no books is a valid, empty answer. */
export function parseModelOutput(text: string): ParsedOutput {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  const env = envelope.safeParse(json);
  if (!env.success) return { ok: false, reason: "wrong_shape" };
  const books: DetectedBook[] = [];
  let dropped = 0;
  for (const raw of env.data.books) {
    const b = toDetected(raw);
    if (b) books.push(b);
    else dropped++;
  }
  const ordered = orderDetections(books);
  if (ordered.length > MAX_DETECTED) dropped += ordered.length - MAX_DETECTED;
  return { ok: true, books: ordered.slice(0, MAX_DETECTED), dropped };
}
