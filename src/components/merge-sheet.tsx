"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { loadMergeBooks, mergeBooks } from "@/app/(app)/library/bulk-actions";
import { Cover } from "@/components/cover";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { defaultCoverFrom, mergeSummary, type MergeBook } from "@/lib/books/merge";
import { cn } from "@/lib/utils";

/**
 * Merge the selected books into one. Pick the book to keep (its details win and its empty fields fill from the others),
 * optionally take the cover from another book, read the plain summary, then confirm. The books are loaded when the
 * sheet opens, so the library list does not carry ISBNs and copy counts for every row.
 */
export function MergeSheet({
  libraryId,
  bookIds,
  onClose,
  onDone,
}: {
  libraryId: string;
  bookIds: string[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [books, setBooks] = useState<MergeBook[] | null>(null);
  const [keepId, setKeepId] = useState<string | null>(null);
  const [coverId, setCoverId] = useState<string | null>(null);
  const [coverTouched, setCoverTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const uid = useId();

  useEffect(() => {
    let live = true;
    void loadMergeBooks({ libraryId, bookIds }).then((res) => {
      if (!live) return;
      if (!res.ok) return setError(res.error);
      setBooks(res.books);
      setKeepId(res.books[0].id);
      setCoverId(defaultCoverFrom(res.books, res.books[0].id));
    });
    return () => {
      live = false;
    };
    // The selection is fixed while the sheet is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function chooseKeep(id: string) {
    setKeepId(id);
    // Until a cover is chosen by hand, it follows the kept book (or the first book that has one).
    if (!coverTouched && books) setCoverId(defaultCoverFrom(books, id));
  }

  function confirm() {
    if (!books || !keepId) return;
    setError(null);
    start(async () => {
      const res = await mergeBooks({
        libraryId,
        keepId,
        mergeIds: books.filter((b) => b.id !== keepId).map((b) => b.id),
        coverFromId: coverId,
      });
      if (!res.ok) return setError(res.error);
      router.refresh();
      onDone(res.message);
      onClose();
    });
  }

  const count = books?.length ?? bookIds.length;

  return (
    <Sheet open onOpenChange={(o) => !o && !pending && onClose()}>
      <SheetContent title="Merge books" description={`${count} selected`} className="md:max-w-3xl">
        {!books ? (
          <div className="px-5 py-8">
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> Loading the books
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
              <p className="text-sm text-muted-foreground">
                The book you keep stays as it is. Its empty fields are filled from the others, and every copy, reading record and shelf moves to it.
              </p>
              <fieldset className="min-w-0">
                <legend className="sr-only">Which book do you keep?</legend>
                <ul className="grid gap-3 md:grid-cols-2">
                  {books.map((b) => {
                    const keeping = b.id === keepId;
                    return (
                      <li
                        key={b.id}
                        className={cn(
                          "flex min-w-0 flex-col gap-1 rounded-[14px] border bg-card p-3 transition-colors duration-[var(--dur-fast)]",
                          keeping ? "border-primary bg-accent/50" : "border-border",
                        )}
                      >
                        <div className="flex min-w-0 gap-3">
                          <div className="w-16 shrink-0 self-start">
                            <Cover url={b.coverUrl} title={b.title} author={b.authors[0]} sizes="64px" />
                          </div>
                          <dl className="min-w-0 flex-1 text-sm">
                            <dt className="sr-only">Title</dt>
                            <dd className="font-display text-base leading-snug font-medium">{b.title}</dd>
                            <dt className="sr-only">Author</dt>
                            <dd className="text-muted-foreground">{b.authors.join(", ") || "Unknown author"}</dd>
                            {b.seriesName && (
                              <>
                                <dt className="sr-only">Series</dt>
                                <dd>
                                  {b.seriesName}
                                  {b.seriesPosition != null ? ` #${b.seriesPosition}` : ""}
                                </dd>
                              </>
                            )}
                            <dt className="sr-only">ISBN</dt>
                            <dd className="text-muted-foreground tabular-nums">{b.isbn13 ?? "No ISBN"}</dd>
                            <dt className="sr-only">Published</dt>
                            <dd className="text-muted-foreground">{b.publishedDate ? b.publishedDate.slice(0, 4) : "No year"}</dd>
                            <dt className="sr-only">Copies</dt>
                            <dd>
                              {b.copies} {b.copies === 1 ? "copy" : "copies"}
                            </dd>
                          </dl>
                        </div>
                        <RadioRow
                          name={`${uid}-keep`}
                          checked={keeping}
                          disabled={pending}
                          onChange={() => chooseKeep(b.id)}
                          label="Keep this one"
                          aria-label={`Keep ${b.title}`}
                          strong
                        />
                        {b.coverUrl ? (
                          <RadioRow
                            name={`${uid}-cover`}
                            checked={coverId === b.id}
                            disabled={pending}
                            onChange={() => {
                              setCoverTouched(true);
                              setCoverId(b.id);
                            }}
                            label="Use this cover"
                            aria-label={`Use the cover of ${b.title}`}
                          />
                        ) : (
                          <p className="flex h-11 items-center text-sm text-muted-foreground">No cover to use</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-3 border-t border-border bg-card px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <p className="text-sm">{keepId ? mergeSummary(books, keepId) : ""}</p>
              <Button type="button" size="lg" className="w-full" disabled={pending || !keepId} onClick={confirm}>
                {pending ? "Merging…" : `Merge ${books.length} books`}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** A real radio input, hidden visually but focusable, with a 44px label row and a visible dot. */
function RadioRow({
  name,
  checked,
  disabled,
  onChange,
  label,
  strong,
  "aria-label": ariaLabel,
}: {
  name: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
  label: string;
  strong?: boolean;
  "aria-label": string;
}) {
  return (
    <label className={cn("group flex h-11 cursor-pointer items-center gap-3 rounded-lg px-1 text-sm", disabled && "cursor-default opacity-60", strong && "font-semibold")}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} aria-label={ariaLabel} className="peer sr-only" />
      <span
        aria-hidden
        className="flex size-5 shrink-0 items-center justify-center rounded-full border border-input bg-card transition-colors duration-[var(--dur-fast)] group-hover:border-foreground/50 peer-checked:border-primary peer-checked:after:size-2.5 peer-checked:after:rounded-full peer-checked:after:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-card"
      />
      <span>{label}</span>
    </label>
  );
}
