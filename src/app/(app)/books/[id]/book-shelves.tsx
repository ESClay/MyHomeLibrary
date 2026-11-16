"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { removeBooksFromShelf } from "@/app/(app)/shelves/actions";
import { AssignSheet } from "@/components/assign-sheet";
import { PrivateMark, ShelfBadge } from "@/components/shelf-icon";
import { Button } from "@/components/ui/button";
import type { ShelfColor } from "@/lib/shelves/constants";

export type ChipShelf = { id: string; name: string; color: ShelfColor; icon: string | null; private: boolean; removable: boolean };

/** The manual shelves a book is on, as chips (lock marks private ones), with add and remove. */
export function BookShelves({ bookId, libraryId, shelves }: { bookId: string; libraryId: string; shelves: ChipShelf[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function remove(shelfId: string) {
    setError(null);
    start(async () => {
      const res = await removeBooksFromShelf({ shelfId, bookIds: [bookId] });
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {shelves.length === 0 ? (
        <p className="text-base text-muted-foreground">Not on any shelf yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {shelves.map((s) => (
            <li key={s.id} className="flex min-h-11 items-center rounded-lg border border-input bg-card pr-1 pl-1.5">
              <Link href={`/shelves/${s.id}`} className="flex min-h-11 items-center gap-2 pr-2 text-[0.9375rem] font-medium hover:underline hover:decoration-gilt hover:underline-offset-4">
                <ShelfBadge color={s.color} icon={s.icon} className="size-6" />
                {s.name}
                {s.private && <PrivateMark />}
              </Link>
              {s.removable && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => remove(s.id)}
                  aria-label={`Remove from ${s.name}`}
                  className="flex size-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  <X aria-hidden className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button type="button" variant="outline" onClick={() => setAdding(true)}>
          <Plus aria-hidden /> Add to shelf
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {adding && <AssignSheet mode="add" libraryId={libraryId} bookIds={[bookId]} exclude={shelves.map((s) => s.id)} onClose={() => setAdding(false)} />}
    </div>
  );
}
