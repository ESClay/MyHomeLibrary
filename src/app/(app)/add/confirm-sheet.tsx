"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { addCopy, createBook, type DuplicateInfo } from "@/app/(app)/books/actions";
import {
  BookFields,
  CopyFields,
  copyDraftToInput,
  draftFromMetadata,
  draftToFields,
  emptyBookDraft,
  emptyCopyDraft,
  Field,
  type BookDraft,
  type CopyDraft,
} from "@/components/book-forms";
import { BorrowerPicker, borrowerChoice, emptyBorrower, type BorrowerOption, type BorrowerState } from "@/components/borrower-picker";
import { CoverPicker } from "@/components/cover-picker";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { RATING_SOURCE_LABEL, STATUSES, STATUS_LABEL, type Ownership, type Status } from "@/lib/books/constants";
import type { BookMetadata } from "@/lib/metadata/types";
import { cn } from "@/lib/utils";

export function ConfirmSheet({
  libraryId,
  candidate,
  initialIsbn,
  borrowers,
  currency = null,
  onClose,
}: {
  libraryId: string;
  /** null = manual entry */
  candidate: BookMetadata | null;
  /** Prefills the ISBN of a by-hand entry (from a scan the lookup could not find). */
  initialIsbn?: string;
  /** The library's borrowers list. Passing it adds the "I borrowed this" choice. */
  borrowers?: BorrowerOption[];
  /** The library currency, for the price field. */
  currency?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const manual = candidate === null;

  const [draft, setDraft] = useState<BookDraft>(candidate ? draftFromMetadata(candidate) : { ...emptyBookDraft, isbn13: initialIsbn ?? "" });
  const [ownership, setOwnership] = useState<Ownership>("owned");
  const [copy, setCopy] = useState<CopyDraft>(emptyCopyDraft);
  const [lender, setLender] = useState<BorrowerState>(emptyBorrower);
  const [dueBack, setDueBack] = useState("");
  const [myStatus, setMyStatus] = useState<Status | "">("");
  const [cover, setCover] = useState<string | null>(candidate?.covers[0]?.url ?? null);
  const [showDetails, setShowDetails] = useState(manual);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateInfo[] | null>(null);

  const candidates = useMemo(
    () => (candidate?.covers ?? []).map((c) => ({ url: c.url, label: RATING_SOURCE_LABEL[c.source] ?? c.source })),
    [candidate],
  );

  function payload(force: boolean) {
    return {
      libraryId,
      book: draftToFields(draft, ownership, cover),
      provider: {
        hardcoverId: candidate?.ids.hardcover ?? null,
        googleBooksId: candidate?.ids.google ?? null,
        olKey: candidate?.ids.openLibrary ?? null,
        publicRating: candidate?.rating?.value ?? null,
        publicRatingCount: candidate?.rating?.count ?? null,
        ratingSource: candidate?.rating?.source ?? null,
      },
      copy: ownership === "owned" ? copyDraftToInput(copy) : null,
      myStatus: ownership === "wishlist" ? "want" : myStatus === "" ? null : myStatus,
      borrowedFrom: ownership === "borrowed" ? { who: borrowerChoice(lender) ?? {}, dueDate: dueBack } : null,
      force,
    } as const;
  }

  function save(force = false) {
    setError(null);
    startTransition(async () => {
      const res = await createBook(payload(force));
      if (res.ok) {
        router.push(`/books/${res.id}`);
        return;
      }
      if (res.duplicates?.length) setDuplicates(res.duplicates);
      else setError(res.error);
    });
  }

  function addToExisting(bookId: string) {
    setError(null);
    startTransition(async () => {
      const res = await addCopy({ bookId, copy: copyDraftToInput(copy) });
      if (res.ok) router.push(`/books/${bookId}`);
      else setError(res.error);
    });
  }

  const title = draft.title.trim();

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent title={duplicates ? "Already in your library" : manual ? "Add a book by hand" : "Add this book"} description={duplicates ? title : undefined}>
        {duplicates ? (
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
            <p className="text-base">
              {duplicates.length === 1 ? "A matching book is already on your shelves." : "Matching books are already on your shelves."}
            </p>
            <ul className="flex flex-col gap-3">
              {duplicates.map((d) => (
                <li key={d.id} className="panel flex flex-col gap-3 p-4">
                  <div>
                    <p className="font-display text-lg leading-snug font-medium">{d.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {d.authors.join(", ") || "Unknown author"} · matched by {d.reason === "isbn" ? "ISBN" : "title and author"}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {ownership === "owned" && (
                      <Button type="button" disabled={pending} onClick={() => addToExisting(d.id)}>
                        Add another copy
                      </Button>
                    )}
                    <Button asChild variant="outline">
                      <Link href={`/books/${d.id}`}>Open existing book</Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <p className="text-sm text-muted-foreground">It is a different book, or a different work with the same name?</p>
              <Button type="button" variant="secondary" disabled={pending} onClick={() => save(true)}>
                Add as a separate book
              </Button>
              <Button type="button" variant="ghost" disabled={pending} onClick={() => setDuplicates(null)}>
                Back to the details
              </Button>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        ) : (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
              {!manual && (
                <div className="flex flex-col gap-1">
                  <p className="font-display text-lg leading-snug font-medium">{title}</p>
                  <p className="text-sm text-muted-foreground">{draft.authors || "Unknown author"}</p>
                </div>
              )}

              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-semibold">Where does it go?</legend>
                <div className={cn("grid gap-2", borrowers ? "grid-cols-3" : "grid-cols-2")} role="radiogroup" aria-label="Owned, wishlist or borrowed">
                  {(borrowers ? (["owned", "wishlist", "borrowed"] as const) : (["owned", "wishlist"] as const)).map((o) => (
                    <label key={o} className="cursor-pointer">
                      <input type="radio" name="ownership" value={o} checked={ownership === o} onChange={() => setOwnership(o)} className="peer sr-only" />
                      <span
                        className={cn(
                          "flex h-11 items-center justify-center rounded-lg border border-input bg-card px-1 text-center text-sm leading-tight font-medium sm:text-[0.9375rem] transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring hover:border-foreground/40",
                        )}
                      >
                        {o === "owned" ? "On my shelf" : o === "wishlist" ? "On my wishlist" : "I borrowed this"}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {ownership === "borrowed" && borrowers && (
                <section className="flex flex-col gap-4">
                  <h3 className="font-display text-lg font-medium">Who lent it?</h3>
                  <BorrowerPicker borrowers={borrowers} value={lender} onChange={setLender} label="Borrowed from" />
                  <Field label="Due back (optional)" hint="It shows as Overdue the day after.">
                    {(id) => <Input id={id} type="date" value={dueBack} onChange={(e) => setDueBack(e.target.value)} />}
                  </Field>
                  <Field label="Your reading status">
                    {(id) => (
                      <NativeSelect id={id} value={myStatus} onChange={(e) => setMyStatus(e.target.value as Status | "")}>
                        <option value="">Not set</option>
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </Field>
                </section>
              )}

              {ownership === "owned" && (
                <section className="flex flex-col gap-4">
                  <h3 className="font-display text-lg font-medium">First copy</h3>
                  <CopyFields draft={copy} onChange={setCopy} currency={currency} />
                  <Field label="Your reading status">
                    {(id) => (
                      <NativeSelect id={id} value={myStatus} onChange={(e) => setMyStatus(e.target.value as Status | "")}>
                        <option value="">Not set</option>
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </Field>
                </section>
              )}

              <CoverPicker libraryId={libraryId} candidates={candidates} value={cover} onChange={setCover} />

              <section className="flex flex-col gap-3">
                {!manual && (
                  <button
                    type="button"
                    aria-expanded={showDetails}
                    onClick={() => setShowDetails((v) => !v)}
                    className="flex h-11 w-full cursor-pointer items-center justify-between rounded-lg text-left text-sm font-semibold"
                  >
                    Edit details
                    <ChevronDown className={cn("size-4 transition-transform duration-[var(--dur)]", showDetails && "rotate-180")} aria-hidden />
                  </button>
                )}
                {showDetails && <BookFields draft={draft} onChange={setDraft} />}
              </section>

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <div className="border-t border-border bg-card px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <Button type="submit" size="lg" className="w-full" disabled={pending || title === "" || (ownership === "borrowed" && !borrowerChoice(lender))}>
                {pending ? "Adding…" : ownership === "owned" ? "Add to my shelf" : ownership === "wishlist" ? "Add to my wishlist" : "Add as borrowed"}
              </Button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
