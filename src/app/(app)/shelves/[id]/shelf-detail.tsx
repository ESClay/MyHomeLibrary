"use client";

import { useCallback, useEffect, useReducer, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, CheckSquare, GripVertical, LayoutGrid, List, Loader2, Pencil, Rows3, SlidersHorizontal, Trash2 } from "lucide-react";
import { BookGrid, BookList, type ViewMode } from "@/components/book-grid";
import { Cover } from "@/components/cover";
import { PrivateMark, ShelfBadge } from "@/components/shelf-icon";
import { NEW_SHELF, ShelfFormSheet } from "@/components/shelf-form";
import { useDragSort } from "@/components/sortable";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { LibraryItem } from "@/lib/books/library-query";
import type { LibraryRole } from "@/lib/library";
import { SHELF_SORT_LABEL } from "@/lib/shelves/constants";
import { moveItem, orderReducer } from "@/lib/shelves/order";
import { describeRules } from "@/lib/shelves/rules";
import type { Shelf } from "@/lib/shelves/types";
import { cn } from "@/lib/utils";
import { deleteShelf, loadShelfPage, moveShelfBook, removeBooksFromShelf } from "../actions";

/** Start loading the next page this far before the end of the list (the library list uses the same). */
const LOAD_AHEAD = "800px";

type Feed = { extra: LibraryItem[]; hasMore: boolean; status: "idle" | "loading" | "error" };

function SortRow({
  book,
  index,
  total,
  drag,
  onMove,
}: {
  book: LibraryItem;
  index: number;
  total: number;
  drag: ReturnType<typeof useDragSort>;
  onMove: (id: string, to: number) => void;
}) {
  const dragging = drag.dragId === book.id;
  const target = drag.dragId !== null && drag.overIndex === index && !dragging;
  return (
    <li
      ref={drag.register(book.id)}
      className={cn(
        "panel flex min-h-[4.5rem] items-center gap-1 p-1.5 pr-2 transition-[box-shadow,opacity,border-color] duration-[var(--dur-fast)]",
        dragging && "opacity-60 shadow-[var(--shadow-cover)]",
        target && "border-gilt ring-2 ring-gilt/50",
      )}
    >
      <button
        type="button"
        aria-label={`Drag ${book.title}. Or use the arrow keys.`}
        {...drag.handleProps(book.id)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
            e.preventDefault();
            onMove(book.id, index - 1);
          } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
            e.preventDefault();
            onMove(book.id, index + 1);
          }
        }}
        className="flex size-11 shrink-0 cursor-grab items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      >
        <GripVertical aria-hidden className="size-5" />
      </button>
      <Cover url={book.coverUrl} title={book.title} author={book.authors[0]} className="w-10 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col pl-1.5">
        <span className="truncate text-[0.9375rem] font-medium">{book.title}</span>
        <span className="truncate text-sm text-muted-foreground">{book.authors[0] ?? "Unknown author"}</span>
      </span>
      <Button type="button" variant="ghost" size="icon" disabled={index === 0} onClick={() => onMove(book.id, index - 1)} aria-label={`Move ${book.title} up`}>
        <ArrowUp aria-hidden />
      </Button>
      <Button type="button" variant="ghost" size="icon" disabled={index === total - 1} onClick={() => onMove(book.id, index + 1)} aria-label={`Move ${book.title} down`}>
        <ArrowDown aria-hidden />
      </Button>
    </li>
  );
}

export function ShelfDetail({
  shelf,
  books: firstPage,
  total,
  hasMore: firstHasMore,
  libraryName,
  role,
  canManage,
  canChangeBooks,
  rulesHref,
}: {
  shelf: Shelf;
  /** All of a manual shelf's books, or the first page of a smart shelf's. */
  books: LibraryItem[];
  total: number;
  hasMore: boolean;
  libraryName: string;
  role: LibraryRole;
  canManage: boolean;
  canChangeBooks: boolean;
  rulesHref: string | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("grid");
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [arranging, setArranging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [pending, start] = useTransition();
  // A smart shelf's later pages. The page remounts (its key) when the shelf's books change, which starts the feed over.
  const [feed, setFeed] = useState<Feed>({ extra: [], hasMore: firstHasMore, status: "idle" });
  const books = feed.extra.length ? [...firstPage, ...feed.extra] : firstPage;
  const sentinel = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const count = useRef(books.length);
  useEffect(() => {
    count.current = books.length;
  });
  const loadMore = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setFeed((f) => ({ ...f, status: "loading" }));
    let res: Awaited<ReturnType<typeof loadShelfPage>>;
    try {
      res = await loadShelfPage({ shelfId: shelf.id, offset: count.current });
    } catch {
      res = { ok: false, error: "Could not load more books." };
    }
    inFlight.current = false;
    setFeed((f) => {
      if (!res.ok) return { ...f, status: "error" };
      const seen = new Set([...firstPage, ...f.extra].map((i) => i.id));
      return { extra: [...f.extra, ...res.items.filter((i) => !seen.has(i.id))], hasMore: res.hasMore, status: "idle" };
    });
  }, [shelf.id, firstPage]);
  const canObserve = feed.hasMore && feed.status === "idle";
  useEffect(() => {
    const el = sentinel.current;
    if (!canObserve || !el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void loadMore(), { rootMargin: `0px 0px ${LOAD_AHEAD} 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [canObserve, books.length, loadMore]);

  const [order, dispatch] = useReducer(orderReducer, books.map((b) => b.id));
  const saved = useRef(order);

  const custom = shelf.sort === "custom" && shelf.kind === "manual";
  const byId = new Map(books.map((b) => [b.id, b]));
  const shown = custom ? order.map((id) => byId.get(id)).filter((b): b is LibraryItem => !!b) : books;
  const chips = shelf.rules ? describeRules(shelf.rules) : [];

  function move(id: string, to: number) {
    const from = order.indexOf(id);
    if (from === -1 || to < 0 || to >= order.length || to === from) return;
    dispatch({ type: "move", id, to });
    setError(null);
    start(async () => {
      const res = await moveShelfBook({ shelfId: shelf.id, bookId: id, toIndex: to });
      if (!res.ok) {
        setError(res.error);
        dispatch({ type: "reset", ids: saved.current });
        return;
      }
      saved.current = moveItem(saved.current, saved.current.indexOf(id), to);
      setAnnounce(`${byId.get(id)?.title ?? "Book"} moved to position ${to + 1} of ${order.length}.`);
    });
  }
  const drag = useDragSort({ ids: order, onMove: move });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  function removeSelected() {
    setError(null);
    start(async () => {
      const res = await removeBooksFromShelf({ shelfId: shelf.id, bookIds: [...selected] });
      if (!res.ok) return setError(res.error);
      stopSelecting();
      router.refresh();
    });
  }

  function remove() {
    setError(null);
    start(async () => {
      const res = await deleteShelf(shelf.id);
      if (!res.ok) {
        setError(res.error);
        setConfirmDelete(false);
        return;
      }
      router.push("/shelves");
    });
  }

  const kindLabel = shelf.kind === "smart" ? "Smart shelf" : "Shelf";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <Link href="/shelves" className="-ml-2 flex h-11 w-fit items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Shelves
      </Link>

      <header className="rise flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <ShelfBadge color={shelf.color} icon={shelf.icon} className="mt-1.5 size-9" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="eyebrow flex items-center gap-2 text-gilt">
              {kindLabel} · {libraryName}
              {shelf.visibility === "private" && (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <PrivateMark /> Only you
                </span>
              )}
            </p>
            <h1 className="page-title break-words">{shelf.name}</h1>
            <p className="text-sm text-muted-foreground">
              {total} {total === 1 ? "book" : "books"} · {SHELF_SORT_LABEL[shelf.sort]}
            </p>
          </div>
        </div>

        {chips.length > 0 && (
          <ul aria-label="Rules" className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <li key={c.key} className="rounded-md border border-border bg-accent px-2 py-1 text-sm">
                {c.label}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          {canManage && (
            <Button type="button" variant="outline" onClick={() => setEditing(true)}>
              <Pencil aria-hidden /> Edit
            </Button>
          )}
          {canManage && rulesHref && (
            <Button asChild variant="outline">
              <Link href={rulesHref}>
                <SlidersHorizontal aria-hidden /> Edit rules
              </Link>
            </Button>
          )}
          {canChangeBooks && custom && books.length > 1 && (
            <Button type="button" variant={arranging ? "secondary" : "outline"} aria-pressed={arranging} onClick={() => (setArranging((a) => !a), stopSelecting())}>
              <Rows3 aria-hidden /> {arranging ? "Done" : "Arrange"}
            </Button>
          )}
          {canChangeBooks && !arranging && books.length > 0 && (
            <Button type="button" variant={selecting ? "secondary" : "outline"} aria-pressed={selecting} onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
              <CheckSquare aria-hidden /> {selecting ? "Done" : "Select"}
            </Button>
          )}
          {canManage && (
            <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden /> Delete
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </header>

      {books.length === 0 ? (
        <div className="panel flex flex-col items-start gap-3 p-6">
          <Rows3 className="size-6 text-muted-foreground" aria-hidden />
          <h2 className="text-xl font-medium">{shelf.kind === "smart" ? "No books match these rules" : "This shelf is empty"}</h2>
          <p className="text-muted-foreground">
            {shelf.kind === "smart" ? "Change the rules, or add books that fit them." : "Add books from a book's page, or select several in the library."}
          </p>
          <Button asChild variant="outline">
            <Link href={rulesHref ?? "/library"}>{rulesHref ? "Edit rules" : "Open the library"}</Link>
          </Button>
        </div>
      ) : arranging ? (
        <section aria-labelledby="order-h" className="flex flex-col gap-3">
          <div>
            <h2 id="order-h" className="text-xl font-medium">
              Put the books in order
            </h2>
            <p className="text-sm text-muted-foreground">Drag the handle, or use the arrows.</p>
          </div>
          <ul className="flex flex-col gap-2">
            {shown.map((b, i) => (
              <SortRow key={b.id} book={b} index={i} total={shown.length} drag={drag} onMove={move} />
            ))}
          </ul>
          <p role="status" aria-live="polite" className="sr-only">
            {announce}
          </p>
        </section>
      ) : (
        <>
          <div className="flex justify-end">
            <div role="group" aria-label="View" className="flex rounded-lg border border-input bg-card p-0.5">
              {(
                [
                  ["grid", LayoutGrid, "Cover grid"],
                  ["list", List, "Compact list"],
                ] as const
              ).map(([mode, Icon, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={view === mode}
                  aria-label={label}
                  onClick={() => setView(mode)}
                  className={cn(
                    "flex size-10 cursor-pointer items-center justify-center rounded-md transition-colors duration-[var(--dur-fast)]",
                    view === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                </button>
              ))}
            </div>
          </div>
          {view === "grid" ? (
            <BookGrid items={shown} pending={pending} selection={{ on: selecting, selected, toggle }} />
          ) : (
            <BookList items={shown} pending={pending} selection={{ on: selecting, selected, toggle }} />
          )}
          {(feed.hasMore || feed.status === "error") && (
            <div className="flex min-h-12 flex-col items-center justify-center gap-2 pt-2 text-sm text-muted-foreground">
              {feed.hasMore && <div ref={sentinel} aria-hidden className="h-px w-full" />}
              {feed.status === "loading" && (
                <p role="status" className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Loading more books
                </p>
              )}
              {feed.status === "error" && (
                <div role="alert" className="flex items-center gap-3">
                  <span>Could not load more books.</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => setFeed((f) => ({ ...f, status: "idle" }))}>
                    Try again
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {selecting && (
        <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 flex flex-col gap-2 rounded-[14px] border border-border bg-card p-3 shadow-[var(--shadow-card)] md:bottom-4">
          <div className="flex items-center justify-between gap-3">
            <p role="status" aria-live="polite" className="text-sm font-medium">
              {selected.size === 0 ? "Tap books to select them" : `${selected.size} selected`}
            </p>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set(books.map((b) => b.id)))}>
              Select all
            </Button>
          </div>
          <Button type="button" variant="outline" disabled={selected.size === 0 || pending} onClick={removeSelected}>
            {pending ? "Removing…" : "Remove from this shelf"}
          </Button>
        </div>
      )}

      {editing && (
        <ShelfFormSheet
          libraryId={shelf.libraryId}
          shelfId={shelf.id}
          initial={{ ...NEW_SHELF, name: shelf.name, visibility: shelf.visibility, color: shelf.color, icon: shelf.icon, sort: shelf.sort }}
          rules={shelf.rules ?? undefined}
          canShare={role !== "viewer"}
          onClose={() => setEditing(false)}
        />
      )}

      {confirmDelete && (
        <Sheet open onOpenChange={(o) => !o && !pending && setConfirmDelete(false)}>
          <SheetContent title={`Delete “${shelf.name}”?`} description="The books stay in your library.">
            <div className="flex flex-col gap-3 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <p className="text-base">
                {shelf.kind === "smart" ? "The shelf and its rules are removed." : "The shelf and its order are removed, and so is each book's place on it."}
                {shelf.visibility === "shared" ? " Everyone in the library loses it." : ""}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row-reverse">
                <Button type="button" variant="destructive" size="lg" disabled={pending} onClick={remove}>
                  {pending ? "Deleting…" : "Delete shelf"}
                </Button>
                <Button type="button" variant="outline" size="lg" disabled={pending} onClick={() => setConfirmDelete(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
