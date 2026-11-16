"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addBooksToShelves, removeBooksFromShelf } from "@/app/(app)/shelves/actions";
import { ShelfList } from "@/components/shelf-picker";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";

/**
 * Add books to shelves, or take them off one. Opened from a book's page (one book) and from the
 * library's multi-select (many).
 */
export function AssignSheet({
  mode,
  libraryId,
  bookIds,
  exclude,
  onClose,
  onDone,
}: {
  mode: "add" | "remove";
  libraryId: string;
  bookIds: string[];
  exclude?: string[];
  onClose: () => void;
  onDone?: (message: string) => void;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const many = bookIds.length > 1;

  function submit() {
    setError(null);
    start(async () => {
      if (mode === "add") {
        const res = await addBooksToShelves({ shelfIds: chosen, bookIds });
        if (!res.ok) return setError(res.error);
        onDone?.(res.added > 0 ? `Added to ${chosen.length - res.skipped} ${chosen.length - res.skipped === 1 ? "shelf" : "shelves"}.` : "Already on those shelves.");
      } else {
        const results = await Promise.all(chosen.map((shelfId) => removeBooksFromShelf({ shelfId, bookIds })));
        const bad = results.find((r) => !r.ok);
        if (bad && !bad.ok) return setError(bad.error);
        onDone?.(`Removed from ${chosen.length} ${chosen.length === 1 ? "shelf" : "shelves"}.`);
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <Sheet open onOpenChange={(o) => !o && !pending && onClose()}>
      <SheetContent
        title={mode === "add" ? "Add to shelf" : "Remove from shelf"}
        description={many ? `${bookIds.length} books` : undefined}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <ShelfList libraryId={libraryId} value={chosen} onChange={setChosen} disabled={pending} exclude={exclude} allowCreate={mode === "add"} />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="border-t border-border bg-card px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button type="button" size="lg" className="w-full" disabled={pending || chosen.length === 0} onClick={submit}>
            {pending ? "Saving…" : chosen.length === 0 ? "Choose a shelf" : mode === "add" ? `Add to ${chosen.length} ${chosen.length === 1 ? "shelf" : "shelves"}` : `Remove from ${chosen.length} ${chosen.length === 1 ? "shelf" : "shelves"}`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
