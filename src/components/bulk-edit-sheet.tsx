"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkSetCopyFields, bulkSetStatus } from "@/app/(app)/library/bulk-actions";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { copyResultMessage } from "@/lib/books/bulk";
import {
  CONDITIONS,
  CONDITION_LABEL,
  FORMATS,
  FORMAT_LABEL,
  STATUSES,
  STATUS_LABEL,
  type Condition,
  type Format,
  type Status,
} from "@/lib/books/constants";

const LEAVE = "";

/**
 * Change my status, format and condition on the selected books in one go. Each field starts on "Leave as is", and only
 * the fields that were set are sent. Viewers only get My status: format and condition are the library's, theirs to
 * read but not to change.
 */
export function BulkEditSheet({
  libraryId,
  bookIds,
  canEditCopies,
  onClose,
  onDone,
}: {
  libraryId: string;
  bookIds: string[];
  canEditCopies: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status | typeof LEAVE>(LEAVE);
  const [format, setFormat] = useState<Format | typeof LEAVE>(LEAVE);
  const [condition, setCondition] = useState<Condition | typeof LEAVE>(LEAVE);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const copySet = canEditCopies && (format !== LEAVE || condition !== LEAVE);
  const changes = (status !== LEAVE ? 1 : 0) + (copySet ? 1 : 0);
  const count = bookIds.length;

  function submit() {
    setError(null);
    start(async () => {
      const messages: string[] = [];
      let failed: string | null = null;
      if (status !== LEAVE) {
        const res = await bulkSetStatus({ libraryId, bookIds, status });
        if (res.ok) messages.push(`Set ${STATUS_LABEL[status].toLowerCase()} on ${res.updated} ${res.updated === 1 ? "book" : "books"}.`);
        else failed = res.error;
      }
      if (!failed && copySet) {
        const res = await bulkSetCopyFields({
          libraryId,
          bookIds,
          format: format === LEAVE ? undefined : format,
          condition: condition === LEAVE ? undefined : condition,
        });
        if (res.ok) messages.push(copyResultMessage(res));
        else failed = res.error;
      }
      if (messages.length) router.refresh();
      if (failed) {
        // Say what did go through, so a retry is not a surprise.
        return setError(messages.length ? `${messages.join(" ")} Then: ${failed}` : failed);
      }
      onDone(messages.join(" "));
      onClose();
    });
  }

  return (
    <Sheet open onOpenChange={(o) => !o && !pending && onClose()}>
      <SheetContent title="Edit selected" description={`${count} ${count === 1 ? "book" : "books"}`}>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
          <p className="text-sm text-muted-foreground">Only the fields you change are applied. Everything left as is stays as it is.</p>
          <Field label="My status" note="Yours alone. Ratings and notes are kept.">
            <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as Status | typeof LEAVE)} disabled={pending}>
              <option value={LEAVE}>Leave as is</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {canEditCopies && (
            <fieldset className="flex flex-col gap-5 border-t border-border pt-5">
              <legend className="eyebrow -mt-[1.6rem] bg-card pr-3 text-gilt">The copy on the shelf</legend>
              <Field label="Format">
                <NativeSelect value={format} onChange={(e) => setFormat(e.target.value as Format | typeof LEAVE)} disabled={pending}>
                  <option value={LEAVE}>Leave as is</option>
                  {FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {FORMAT_LABEL[f]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Condition">
                <NativeSelect value={condition} onChange={(e) => setCondition(e.target.value as Condition | typeof LEAVE)} disabled={pending}>
                  <option value={LEAVE}>Leave as is</option>
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {CONDITION_LABEL[c]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <p className="text-sm text-muted-foreground">Books with more than one copy are skipped, so the right copy is never guessed.</p>
            </fieldset>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="border-t border-border bg-card px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button type="button" size="lg" className="w-full" disabled={pending || changes === 0} onClick={submit}>
            {pending ? "Saving…" : changes === 0 ? "Choose something to change" : `Apply to ${count} ${count === 1 ? "book" : "books"}`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      {children}
      {note && <span className="text-sm text-muted-foreground">{note}</span>}
    </label>
  );
}
