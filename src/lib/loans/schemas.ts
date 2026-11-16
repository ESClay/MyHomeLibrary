import { z } from "zod";

const uuid = z.string().uuid();

/** Who: an existing borrower, or a new name added on the spot. Exactly one of the two. */
export const borrowerChoiceSchema = z
  .object({
    borrowerId: uuid.optional(),
    newName: z.string().trim().min(1, "Enter a name.").max(100).optional(),
    newNote: z.string().trim().max(500).optional(),
  })
  .refine((v) => (v.borrowerId ? !v.newName : !!v.newName), "Pick a person or add a new one.");
export type BorrowerChoice = z.infer<typeof borrowerChoiceSchema>;

/** `YYYY-MM-DD` or empty. */
export const dueDate = z
  .string()
  .trim()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Use a valid due date.")
  .optional();

export const lendSchema = z.object({ copyId: uuid, who: borrowerChoiceSchema, dueDate });
export const returnSchema = z.object({ loanId: uuid });
export const returnBorrowedSchema = z.object({ bookId: uuid, then: z.enum(["remove", "wishlist"]) });
export const borrowerSchema = z.object({
  libraryId: uuid,
  name: z.string().trim().min(1, "Enter a name.").max(100),
  note: z.string().trim().max(500).optional(),
});
