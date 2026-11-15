"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Pencil, RefreshCw, Search, Trash2 } from "lucide-react";
import { deleteBook, refreshMetadata, setCover, updateBook } from "@/app/(app)/books/actions";
import { BookFields, draftFromMetadata, draftToFields, type BookDraft } from "@/components/book-forms";
import { CoverPicker } from "@/components/cover-picker";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { BookRow } from "@/lib/books/data";
import { RATING_SOURCE_LABEL, type Ownership } from "@/lib/books/constants";
import type { BookMetadata } from "@/lib/metadata/types";
import { cn } from "@/lib/utils";

function draftFromBook(b: BookRow): BookDraft {
  return draftFromMetadata({
    title: b.title,
    subtitle: b.subtitle,
    authors: b.authors,
    seriesName: b.series_name,
    seriesPosition: b.series_position,
    description: b.description,
    covers: [],
    pageCount: b.page_count,
    publishedDate: b.published_date,
    genres: b.genres,
    isbn13: b.isbn13,
    isbn10: null,
    ids: {},
    rating: null,
    providers: [],
  } satisfies BookMetadata);
}

/** Editor-only controls: refresh metadata, edit details, change the cover. */
export function BookActions({ book }: { book: BookRow }) {
  const [sheet, setSheet] = useState<"details" | "cover" | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [pending, startTransition] = useTransition();

  function refresh() {
    setMessage(null);
    startTransition(async () => {
      const res = await refreshMetadata(book.id);
      setMessage(res.ok ? { text: res.message, tone: "ok" } : { text: res.error, tone: "error" });
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setSheet("details")}>
          <Pencil aria-hidden /> Edit details
        </Button>
        <Button type="button" variant="outline" onClick={() => setSheet("cover")}>
          <ImagePlus aria-hidden /> Change cover
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={refresh}>
          <RefreshCw aria-hidden className={cn(pending && "animate-spin")} /> {pending ? "Refreshing…" : "Refresh metadata"}
        </Button>
      </div>
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={cn("text-sm", message.tone === "error" ? "text-destructive" : "text-muted-foreground")}>
          {message.text}
        </p>
      )}
      {sheet === "details" && <DetailsSheet book={book} onClose={() => setSheet(null)} />}
      {sheet === "cover" && <CoverSheet book={book} onClose={() => setSheet(null)} />}
    </div>
  );
}

function DetailsSheet({ book, onClose }: { book: BookRow; onClose: () => void }) {
  const [draft, setDraft] = useState(() => draftFromBook(book));
  const [ownership, setOwnership] = useState<Ownership>(book.ownership);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateBook({ bookId: book.id, book: draftToFields(draft, ownership, book.cover_url) });
      if (res.ok) onClose();
      else setError(res.error);
    });
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent title="Edit details" description={book.title}>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">Where does it go?</legend>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Owned or wishlist">
                {(["owned", "wishlist"] as const).map((o) => (
                  <label key={o} className="cursor-pointer">
                    <input type="radio" name="ownership" value={o} checked={ownership === o} onChange={() => setOwnership(o)} className="peer sr-only" />
                    <span className="flex h-11 items-center justify-center rounded-lg border border-input bg-card text-[0.9375rem] font-medium transition-colors hover:border-foreground/40 peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                      {o === "owned" ? "On my shelf" : "On my wishlist"}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <BookFields draft={draft} onChange={setDraft} />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <div className="border-t border-border px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button type="submit" size="lg" className="w-full" disabled={pending || draft.title.trim() === ""}>
              {pending ? "Saving…" : "Save details"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function CoverSheet({ book, onClose }: { book: BookRow; onClose: () => void }) {
  const [value, setValue] = useState<string | null>(book.cover_url);
  const [found, setFound] = useState<{ url: string; label: string }[]>([]);
  const [finding, setFinding] = useState(false);
  const [findNote, setFindNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const candidates = [
    ...(book.cover_url ? [{ url: book.cover_url, label: "Current" }] : []),
    ...found.filter((o) => o.url !== book.cover_url),
  ];

  async function findCovers() {
    setFinding(true);
    setFindNote(null);
    try {
      const query = book.isbn13 ? `isbn=${book.isbn13}` : `q=${encodeURIComponent(`${book.title} ${book.authors[0] ?? ""}`.trim())}`;
      const res = await fetch(`/api/metadata?${query}`);
      if (!res.ok) throw new Error("lookup failed");
      const body = (await res.json()) as { results: BookMetadata[] };
      const urls = body.results.slice(0, 3).flatMap((m) => m.covers.map((c) => ({ url: c.url, label: RATING_SOURCE_LABEL[c.source] ?? c.source })));
      setFound(urls);
      if (urls.length === 0) setFindNote("No other covers turned up.");
    } catch {
      setFindNote("Cover search is unavailable right now.");
    } finally {
      setFinding(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent title="Change the cover" description={book.title}>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
            <CoverPicker libraryId={book.library_id} candidates={candidates} value={value} onChange={setValue} />
            <div className="flex flex-col items-start gap-2">
              <Button type="button" variant="secondary" disabled={finding} onClick={findCovers}>
                <Search aria-hidden /> {finding ? "Looking…" : "Find covers online"}
              </Button>
              {findNote && (
                <p role="status" className="text-sm text-muted-foreground">
                  {findNote}
                </p>
              )}
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <div className="border-t border-border px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={pending || value === book.cover_url}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const res = await setCover({ bookId: book.id, coverUrl: value });
                  if (res.ok) onClose();
                  else setError(res.error);
                })
              }
            >
              {pending ? "Saving…" : "Use this cover"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function DeleteBook({ bookId, title }: { bookId: string; title: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
        <Trash2 aria-hidden /> Delete this book
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-base">
        Delete <strong className="font-semibold">{title}</strong> with its copies, and everyone&rsquo;s ratings, notes and reads? This cannot be undone.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const res = await deleteBook(bookId);
              if (res.ok) router.replace("/library");
              else setError(res.error);
            })
          }
        >
          {pending ? "Deleting…" : "Yes, delete it"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
          Keep it
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
