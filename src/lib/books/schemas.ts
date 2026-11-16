import { z } from "zod";
import { CONDITIONS, FORMATS, OWNERSHIPS, STATUSES } from "./constants";

const uuid = z.string().uuid();

const trimmed = (max: number) => z.string().trim().max(max);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === "" ? null : s))
    .nullable()
    .optional()
    .transform((s) => s ?? null);

const optNumber = (min: number, max?: number) =>
  z
    .union([z.number(), z.string().trim(), z.null()])
    .optional()
    .transform((v, ctx) => {
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || n < min || (max !== undefined && n > max)) {
        ctx.addIssue({ code: "custom", message: "Enter a valid number." });
        return z.NEVER;
      }
      return n;
    });

const optDate = z
  .union([z.string().trim(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
      ctx.addIssue({ code: "custom", message: "Use a valid date." });
      return z.NEVER;
    }
    return v;
  });

const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((u) => u.startsWith("https://"), "Cover links must be https.");

export const copySchema = z.object({
  format: z.enum(FORMATS),
  condition: z.enum(CONDITIONS).nullable().optional().transform((v) => v ?? null),
  editionIsbn: optText(20),
  purchasePrice: optNumber(0, 100000),
  purchaseDate: optDate,
});
export type CopyInput = z.infer<typeof copySchema>;

export const bookFieldsSchema = z.object({
  title: trimmed(300).min(1, "A title is required."),
  subtitle: optText(300),
  authors: z.array(trimmed(200).min(1)).max(20).default([]),
  seriesName: optText(200),
  seriesPosition: optNumber(0, 10000),
  description: optText(10000),
  coverUrl: httpsUrl.nullable().optional().transform((v) => v ?? null),
  pageCount: optNumber(1, 100000).transform((v) => (v === null ? null : Math.round(v))),
  publishedDate: optText(40),
  genres: z.array(trimmed(80).min(1)).max(20).default([]),
  isbn13: z
    .string()
    .trim()
    .regex(/^\d{13}$/, "ISBN-13 must be 13 digits.")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null))
    .transform((v) => v ?? null),
  ownership: z.enum(OWNERSHIPS),
});
export type BookFieldsInput = z.input<typeof bookFieldsSchema>;

/** Provider data kept with a new book (ids and the public rating). */
export const providerDataSchema = z
  .object({
    hardcoverId: z.number().int().positive().nullable().optional(),
    googleBooksId: trimmed(100).nullable().optional(),
    olKey: trimmed(100).nullable().optional(),
    publicRating: z.number().min(0).max(5).nullable().optional(),
    publicRatingCount: z.number().int().min(0).nullable().optional(),
    ratingSource: trimmed(40).nullable().optional(),
  })
  .default({});

export const createBookSchema = z.object({
  libraryId: uuid,
  book: bookFieldsSchema,
  provider: providerDataSchema,
  /** first copy; not used for wishlist books */
  copy: copySchema.nullable().optional(),
  /** the saver's own status for the book */
  myStatus: z.enum(STATUSES).nullable().optional(),
  /** skip the duplicate check (the user chose "add as separate book") */
  force: z.boolean().optional(),
  /** manual shelves to put the new book on (the "Put on shelves" picker) */
  shelfIds: z.array(uuid).max(20).optional(),
});
export type CreateBookInput = z.input<typeof createBookSchema>;

export const duplicateCheckSchema = z.object({
  libraryId: uuid,
  title: trimmed(300).min(1),
  authors: z.array(trimmed(200)).max(20).default([]),
  isbn13: z.string().trim().regex(/^\d{13}$/).nullable().optional(),
});

export const updateBookSchema = z.object({ bookId: uuid, book: bookFieldsSchema });

export const copyActionSchema = z.object({ bookId: uuid, copy: copySchema });
export const updateCopySchema = z.object({ copyId: uuid, copy: copySchema });

export const myBookSchema = z.object({
  bookId: uuid,
  status: z.enum(STATUSES).optional(),
  rating: z
    .number()
    .min(0.5)
    .max(5)
    .refine((n) => n * 2 === Math.floor(n * 2), "Ratings go in half-star steps.")
    .nullable()
    .optional(),
  notes: z.string().max(10000).nullable().optional(),
});

export const readSchema = z
  .object({ startedAt: optDate, finishedAt: optDate })
  .refine((r) => r.startedAt !== null || r.finishedAt !== null, "Add a start or a finish date.")
  .refine((r) => !r.startedAt || !r.finishedAt || r.finishedAt >= r.startedAt, "The finish date is before the start.");
export const addReadSchema = z.object({ bookId: uuid, read: readSchema });
export const updateReadSchema = z.object({ readId: uuid, read: readSchema });
