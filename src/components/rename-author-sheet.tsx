"use client";

import { useMemo, useState, useTransition } from "react";
import { renameAuthor } from "@/app/(app)/library/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { otherSpellings, type AuthorVariantGroup } from "@/lib/books/author-variants";

const books = (n: number) => `${n} ${n === 1 ? "book" : "books"}`;

/**
 * Fix how one author is spelled across the whole library. The new spelling applies to every book that lists the author,
 * whatever the old punctuation, case or accents were. Only owners and editors reach this sheet.
 */
export function RenameAuthorSheet({
  libraryId,
  author,
  suggested,
  groups,
  onClose,
  onDone,
}: {
  libraryId: string;
  /** The spelling to change; any spelling of the same person works, the database matches them all. */
  author: string;
  /** Prefilled instead of the current spelling, e.g. the one used most. */
  suggested?: string;
  groups: readonly AuthorVariantGroup[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [to, setTo] = useState(suggested ?? author);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const others = useMemo(() => otherSpellings(author, groups).filter((s) => s.name !== to.trim()), [groups, to, author]);
  const name = to.trim();
  const unchanged = name === "" || name === author;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (unchanged || pending) return;
    setError(null);
    start(async () => {
      const res = await renameAuthor({ libraryId, from: author, to: name });
      if (!res.ok) return setError(res.error);
      onDone(res.count === 0 ? "Every book already uses that spelling." : `Spelling changed on ${books(res.count)}.`);
      onClose();
    });
  }

  return (
    <Sheet open onOpenChange={(o) => !o && !pending && onClose()}>
      <SheetContent title="Fix spelling" description={author}>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-semibold">Spell it as</span>
              <Input value={to} onChange={(e) => setTo(e.target.value)} maxLength={200} autoComplete="off" disabled={pending} autoFocus />
            </label>
            {others.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold">Also written as</p>
                <ul className="flex flex-col gap-2">
                  {others.map((s) => (
                    <li key={s.name} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                      <span className="min-w-0 text-[0.9375rem]">
                        {s.name} <span className="text-sm text-muted-foreground">({books(s.books)})</span>
                      </span>
                      <Button type="button" variant="outline" size="sm" className="h-11 shrink-0" onClick={() => setTo(s.name)} disabled={pending}>
                        Use this spelling
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {unchanged
                ? "Type the spelling you want. Every book by this author, however it is written now, will use it."
                : `Every book by ${author}${others.length > 0 ? " or the other spellings above" : ""} will say “${name}”.`}
            </p>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <div className="border-t border-border bg-card px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button type="submit" size="lg" className="w-full" disabled={pending || unchanged}>
              {pending ? "Saving…" : "Save spelling"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
