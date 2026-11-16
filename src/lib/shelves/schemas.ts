import { z } from "zod";
import { SHELF_COLORS, SHELF_ICON_KEYS, SHELF_SORTS, SHELF_VISIBILITIES } from "./constants";
import { saveRulesSchema } from "./rules";

const uuid = z.string().uuid();
const name = z.string().trim().min(1, "Give the shelf a name.").max(100, "Keep the name under 100 characters.");

export const createShelfSchema = z
  .object({
    libraryId: uuid,
    name,
    visibility: z.enum(SHELF_VISIBILITIES).default("shared"),
    color: z.enum(SHELF_COLORS).default("spine-1"),
    icon: z.enum(SHELF_ICON_KEYS).nullable().default(null),
    sort: z.enum(SHELF_SORTS).default("series"),
    /** Present for a smart shelf: the library filters it saves. */
    rules: saveRulesSchema.nullable().default(null),
  })
  .refine((v) => !(v.rules && v.sort === "custom"), { message: "A smart shelf cannot use your own order.", path: ["sort"] });
export type CreateShelfInput = z.input<typeof createShelfSchema>;

export const updateShelfSchema = z.object({
  shelfId: uuid,
  name: name.optional(),
  visibility: z.enum(SHELF_VISIBILITIES).optional(),
  color: z.enum(SHELF_COLORS).optional(),
  icon: z.enum(SHELF_ICON_KEYS).nullable().optional(),
  sort: z.enum(SHELF_SORTS).optional(),
  rules: saveRulesSchema.optional(),
});
export type UpdateShelfInput = z.input<typeof updateShelfSchema>;

export const reorderShelvesSchema = z.object({
  libraryId: uuid,
  /** The visible shelves in the order wanted. */
  ids: z.array(uuid).min(1).max(500),
});

export const shelfBooksSchema = z.object({
  shelfIds: z.array(uuid).min(1).max(20),
  bookIds: z.array(uuid).min(1).max(500),
});

export const removeFromShelfSchema = z.object({
  shelfId: uuid,
  bookIds: z.array(uuid).min(1).max(500),
});

export const moveShelfBookSchema = z.object({
  shelfId: uuid,
  bookId: uuid,
  toIndex: z.number().int().min(0).max(100000),
});
