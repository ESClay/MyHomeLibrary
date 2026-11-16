"use client";

import { useState, useTransition } from "react";
import { lendCopy } from "@/app/(app)/loans/actions";
import { BorrowerPicker, borrowerChoice, emptyBorrower, type BorrowerOption, type BorrowerState } from "@/components/borrower-picker";
import { Field } from "@/components/book-forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";

/** "Lend this copy": who has it, and an optional date it is due back. */
export function LendSheet({ copyId, label, borrowers, onClose }: { copyId: string; label: string; borrowers: BorrowerOption[]; onClose: () => void }) {
  const [who, setWho] = useState<BorrowerState>(emptyBorrower);
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const choice = borrowerChoice(who);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent title="Lend this copy" description={label}>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (!choice) return;
            setError(null);
            startTransition(async () => {
              const res = await lendCopy({ copyId, who: choice, dueDate: due });
              if (res.ok) onClose();
              else setError(res.error);
            });
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
            <BorrowerPicker borrowers={borrowers} value={who} onChange={setWho} label="Lend to" />
            <Field label="Due back (optional)" hint="Leave empty if there is no deadline. It turns Overdue the day after.">
              {(id) => <Input id={id} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}
            </Field>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <div className="border-t border-border px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button type="submit" size="lg" className="w-full" disabled={pending || !choice}>
              {pending ? "Saving…" : "Lend it"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
