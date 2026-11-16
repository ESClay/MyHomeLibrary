"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { StarRating } from "@/components/stars";
import { cn } from "@/lib/utils";
import { logAlreadyRead } from "./actions";

type Placement = "owned" | "wishlist" | "skip";

const OPTIONS: { value: Placement; label: string; hint: string }[] = [
  { value: "owned", label: "On my shelf", hint: "Add it to the library as owned" },
  { value: "wishlist", label: "On my wishlist", hint: "Add it as a book you want to own" },
  { value: "skip", label: "Don't add it", hint: "Just stop suggesting it" },
];

/** The quick "I've read this" sheet: a rating, when it was finished, and whether the book joins the library. */
export function ReadSheet({
  libraryId,
  pick,
  canEdit,
  onClose,
  onDone,
}: {
  libraryId: string;
  pick: { key: string; title: string; authors: string[] };
  canEdit: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [rating, setRating] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState("");
  const [placement, setPlacement] = useState<Placement>(canEdit ? "owned" : "skip");
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await logAlreadyRead({ libraryId, key: pick.key, placement, rating: placement === "skip" ? null : rating, finishedAt: placement === "skip" || !finishedAt ? null : finishedAt });
      if (res.ok) onDone();
      else setError(res.error);
    });
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent title="You've read it" description={pick.title}>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
            <p className="text-sm text-muted-foreground">We will stop suggesting it. If you like, log your rating too.</p>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">Where does it go?</legend>
              <div className="flex flex-col gap-2" role="radiogroup" aria-label="Where the book goes">
                {OPTIONS.map((o) => {
                  const disabled = o.value !== "skip" && !canEdit;
                  return (
                    <label key={o.value} className={cn("cursor-pointer", disabled && "cursor-not-allowed opacity-50")}>
                      <input type="radio" name="placement" value={o.value} checked={placement === o.value} disabled={disabled} onChange={() => setPlacement(o.value)} className="peer sr-only" />
                      <span className="flex min-h-11 flex-col justify-center rounded-lg border border-input bg-card px-4 py-2 transition-colors peer-checked:border-primary peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-ring hover:border-foreground/40">
                        <span className="text-[0.9375rem] font-medium">{o.label}</span>
                        <span className="text-sm text-muted-foreground">{o.hint}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {!canEdit && <p className="text-sm text-muted-foreground">Only owners and editors can add books to the library.</p>}
            </fieldset>

            {placement !== "skip" && (
              <div className="flex flex-col gap-5">
                <StarRating value={rating} onChange={setRating} />
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="read-finished">Finished on (optional)</Label>
                  <Input id="read-finished" type="date" value={finishedAt} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setFinishedAt(e.target.value)} />
                </div>
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2 border-t border-border bg-card px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? "Saving…" : placement === "skip" ? "Done" : "Save"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
