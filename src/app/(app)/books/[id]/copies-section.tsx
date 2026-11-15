"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { addCopy, deleteCopy, updateCopy } from "@/app/(app)/books/actions";
import { CopyFields, Field, copyDraftToInput, emptyCopyDraft, type CopyDraft } from "@/components/book-forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { CONDITION_LABEL, FORMAT_LABEL } from "@/lib/books/constants";
import type { CopyRow } from "@/lib/books/data";
import { formatDate, formatPrice } from "@/lib/format";

function toDraft(c: CopyRow): CopyDraft {
  return {
    format: c.format,
    condition: c.condition ?? "",
    editionIsbn: c.edition_isbn ?? "",
    purchasePrice: c.purchase_price === null ? "" : String(c.purchase_price),
    purchaseDate: c.purchase_date ?? "",
  };
}

export function CopiesSection({ bookId, copies, canEdit }: { bookId: string; copies: CopyRow[]; canEdit: boolean }) {
  const [sheet, setSheet] = useState<{ copy: CopyRow | null } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteCopy(id);
      if (!res.ok) setError(res.error);
      setConfirming(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {copies.length === 0 ? (
        <p className="text-base text-muted-foreground">No copies on the shelf yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {copies.map((c) => (
            <li key={c.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold">
                    {FORMAT_LABEL[c.format]}
                    {c.condition && <span className="font-normal text-muted-foreground"> · {CONDITION_LABEL[c.condition]}</span>}
                  </p>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
                    {c.purchase_price !== null && (
                      <>
                        <dt className="text-muted-foreground">Paid</dt>
                        <dd className="tabular-nums">{formatPrice(c.purchase_price)}</dd>
                      </>
                    )}
                    {c.purchase_date && (
                      <>
                        <dt className="text-muted-foreground">Bought</dt>
                        <dd>{formatDate(c.purchase_date)}</dd>
                      </>
                    )}
                    {c.edition_isbn && (
                      <>
                        <dt className="text-muted-foreground">ISBN</dt>
                        <dd className="tabular-nums">{c.edition_isbn}</dd>
                      </>
                    )}
                  </dl>
                </div>
                {canEdit && (
                  <div className="flex shrink-0">
                    <Button type="button" variant="ghost" size="icon" aria-label={`Edit this ${FORMAT_LABEL[c.format]} copy`} onClick={() => setSheet({ copy: c })}>
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Delete this ${FORMAT_LABEL[c.format]} copy`} onClick={() => setConfirming(c.id)}>
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                )}
              </div>
              {confirming === c.id && (
                <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center">
                  <p className="flex-1 text-sm">Delete this copy? This cannot be undone.</p>
                  <Button type="button" variant="destructive" disabled={pending} onClick={() => remove(c.id)}>
                    Delete copy
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setConfirming(null)}>
                    Keep it
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {canEdit && (
        <div>
          <Button type="button" variant="outline" onClick={() => setSheet({ copy: null })}>
            <Plus aria-hidden /> Add a copy
          </Button>
        </div>
      )}

      {sheet && <CopySheet bookId={bookId} copy={sheet.copy} onClose={() => setSheet(null)} />}
    </div>
  );
}

function CopySheet({ bookId, copy, onClose }: { bookId: string; copy: CopyRow | null; onClose: () => void }) {
  const [draft, setDraft] = useState<CopyDraft>(copy ? toDraft(copy) : emptyCopyDraft);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const input = copyDraftToInput(draft);
      const res = copy ? await updateCopy({ copyId: copy.id, copy: input }) : await addCopy({ bookId, copy: input });
      if (res.ok) onClose();
      else setError(res.error);
    });
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={copy ? "Edit this copy" : "Add a copy"}>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
            <CopyFields draft={draft} onChange={setDraft} />
            <Field label="Edition ISBN" hint="Leave blank to use the book's ISBN.">
              {(id) => (
                <Input
                  id={id}
                  value={draft.editionIsbn}
                  onChange={(e) => setDraft({ ...draft, editionIsbn: e.target.value })}
                  inputMode="numeric"
                  maxLength={17}
                />
              )}
            </Field>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <div className="border-t border-border px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending ? "Saving…" : copy ? "Save copy" : "Add copy"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
