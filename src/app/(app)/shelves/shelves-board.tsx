"use client";

import { useEffect, useReducer, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, BookOpenCheck, GripVertical, Plus, Rows3 } from "lucide-react";
import { Cover } from "@/components/cover";
import { EmptyState, PageHeader } from "@/components/shelf";
import { NEW_SHELF, ShelfFormSheet } from "@/components/shelf-form";
import { PrivateMark, ShelfBadge } from "@/components/shelf-icon";
import { Button } from "@/components/ui/button";
import type { LibraryRole } from "@/lib/library";
import { moveItem, orderReducer } from "@/lib/shelves/order";
import { canWriteShelf } from "@/lib/shelves/permissions";
import type { ReadingGroup, ShelfRowData } from "@/lib/shelves/types";
import { cn } from "@/lib/utils";
import { useDragSort } from "@/components/sortable";
import { reorderShelves } from "./actions";
import { CoverStrip } from "./cover-strip";

function BlankRow({ count, lean }: { count: number; lean?: number }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-end gap-2 px-2">
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className={"book-cover w-[22%] max-w-16 border border-dashed border-input bg-transparent shadow-none" + (i === lean ? " origin-bottom-left rotate-[6deg]" : "")}
          />
        ))}
      </div>
      <div className="shelf-line" />
    </div>
  );
}

function RowHeader({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <header className="flex min-h-11 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">{children}</div>
      {action}
    </header>
  );
}

function ReadingRow({ groups }: { groups: ReadingGroup[] }) {
  const href = groups.some((g) => g.isMe) ? "/library?my=reading" : "/library?partner=reading";
  return (
    <section aria-labelledby="reading-h" className="rise flex flex-col">
      <RowHeader
        action={
          <Link href={href} className="flex min-h-11 items-center px-1 text-sm font-medium underline decoration-gilt decoration-2 underline-offset-4 hover:decoration-foreground">
            See all
          </Link>
        }
      >
        <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-[4px] bg-gilt text-background">
          <BookOpenCheck className="size-3.5" />
        </span>
        <h2 id="reading-h" className="truncate text-xl leading-tight font-medium">
          Currently reading
        </h2>
      </RowHeader>
      {groups.length === 0 ? (
        <CoverStrip covers={[]} empty="Nobody is mid-book. Set a book to Reading on its page and it lands here." />
      ) : (
        <div className="flex flex-col">
          <div className="-mx-4 flex snap-x snap-mandatory items-end gap-6 overflow-x-auto scroll-px-4 px-4 pt-1 [scrollbar-width:none] sm:mx-0 sm:px-0 sm:scroll-px-0 [&::-webkit-scrollbar]:hidden">
            {groups.map((g) => (
              <div key={g.userId} role="group" aria-label={`${g.name}, ${g.count} reading`} className="flex shrink-0 snap-start flex-col gap-2">
                <p className="eyebrow text-gilt">
                  {g.isMe ? `${g.name} (you)` : g.name} · {g.count}
                </p>
                <ul className="flex items-end gap-3 pb-3">
                  {g.covers.map((c) => (
                    <li key={c.id} className="w-[5.5rem] shrink-0 sm:w-28">
                      <Link href={`/books/${c.id}`} aria-label={c.title} className="block rounded-[3px] outline-offset-4">
                        <CoverImg c={c} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="shelf-line" />
        </div>
      )}
    </section>
  );
}

function CoverImg({ c }: { c: { title: string; author: string | null; coverUrl: string | null } }) {
  return <Cover url={c.coverUrl} title={c.title} author={c.author ?? undefined} />;
}

function ShelfRow({ row }: { row: ShelfRowData }) {
  const { shelf, count, covers } = row;
  return (
    <section aria-labelledby={`shelf-${shelf.id}`} className="rise flex flex-col">
      <RowHeader
        action={
          <Link
            href={`/shelves/${shelf.id}`}
            className="flex min-h-11 shrink-0 items-center px-1 text-sm font-medium underline decoration-gilt decoration-2 underline-offset-4 hover:decoration-foreground"
          >
            See all<span className="sr-only"> in {shelf.name}</span>
          </Link>
        }
      >
        <ShelfBadge color={shelf.color} icon={shelf.icon} />
        <h2 id={`shelf-${shelf.id}`} className="truncate text-xl leading-tight font-medium">
          {shelf.name}
        </h2>
        {shelf.visibility === "private" && <PrivateMark />}
        <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
          {count} {count === 1 ? "book" : "books"}
        </span>
      </RowHeader>
      <CoverStrip covers={covers} empty={shelf.kind === "smart" ? "No books match these rules yet." : "Empty. Add books from a book's page or the library."} />
    </section>
  );
}

function ArrangeRow({
  row,
  index,
  total,
  movable,
  drag,
  onMove,
}: {
  row: ShelfRowData;
  index: number;
  total: number;
  movable: boolean;
  drag: ReturnType<typeof useDragSort>;
  onMove: (id: string, to: number) => void;
}) {
  const { shelf } = row;
  const dragging = drag.dragId === shelf.id;
  const target = drag.dragId !== null && drag.overIndex === index && !dragging;
  return (
    <li
      ref={drag.register(shelf.id)}
      className={cn(
        "panel flex min-h-14 items-center gap-1 p-1.5 pr-2 transition-[box-shadow,opacity,border-color] duration-[var(--dur-fast)]",
        dragging && "opacity-60 shadow-[var(--shadow-cover)]",
        target && "border-gilt ring-2 ring-gilt/50",
      )}
    >
      <button
        type="button"
        disabled={!movable}
        aria-label={`Drag ${shelf.name}. Or use the arrow keys.`}
        {...(movable ? drag.handleProps(shelf.id) : {})}
        onKeyDown={(e) => {
          if (!movable) return;
          if (e.key === "ArrowUp") {
            e.preventDefault();
            onMove(shelf.id, index - 1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            onMove(shelf.id, index + 1);
          }
        }}
        className="flex size-11 shrink-0 cursor-grab items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
      >
        <GripVertical aria-hidden className="size-5" />
      </button>
      <ShelfBadge color={shelf.color} icon={shelf.icon} />
      <p className="min-w-0 flex-1 truncate pl-1.5 font-medium">
        {shelf.name}
        {shelf.visibility === "private" && <PrivateMark className="ml-2 align-middle" />}
      </p>
      <Button type="button" variant="ghost" size="icon" disabled={!movable || index === 0} onClick={() => onMove(shelf.id, index - 1)} aria-label={`Move ${shelf.name} up`}>
        <ArrowUp aria-hidden />
      </Button>
      <Button type="button" variant="ghost" size="icon" disabled={!movable || index === total - 1} onClick={() => onMove(shelf.id, index + 1)} aria-label={`Move ${shelf.name} down`}>
        <ArrowDown aria-hidden />
      </Button>
    </li>
  );
}

export function ShelvesBoard({
  libraryId,
  libraryName,
  userId,
  role,
  rows,
  reading,
}: {
  libraryId: string;
  libraryName: string;
  userId: string;
  role: LibraryRole;
  rows: ShelfRowData[];
  reading: ReadingGroup[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [arranging, setArranging] = useState(false);
  const [order, dispatch] = useReducer(orderReducer, rows.map((r) => r.shelf.id));
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [, start] = useTransition();
  const saved = useRef(order);

  // A refresh from the server (a shelf added or removed) replaces the local order.
  const serverIds = rows.map((r) => r.shelf.id).join(",");
  useEffect(() => {
    const ids = serverIds ? serverIds.split(",") : [];
    dispatch({ type: "reset", ids });
    saved.current = ids;
  }, [serverIds]);

  const byId = new Map(rows.map((r) => [r.shelf.id, r]));
  const ordered = order.map((id) => byId.get(id)).filter((r): r is ShelfRowData => !!r);

  function persist(next: string[], movedId: string) {
    setError(null);
    start(async () => {
      const res = await reorderShelves({ libraryId, ids: next });
      if (!res.ok) {
        setError(res.error);
        dispatch({ type: "reset", ids: saved.current });
        return;
      }
      saved.current = next;
      const name = byId.get(movedId)?.shelf.name ?? "Shelf";
      setAnnounce(`${name} moved to position ${next.indexOf(movedId) + 1} of ${next.length}.`);
      router.refresh();
    });
  }

  function move(id: string, to: number) {
    const from = order.indexOf(id);
    if (from === -1 || to < 0 || to >= order.length || to === from) return;
    const next = moveItem(order, from, to);
    dispatch({ type: "move", id, to });
    persist(next, id);
  }

  const drag = useDragSort({ ids: order, onMove: move });
  const canAnyMove = ordered.some((r) => canWriteShelf(role, userId, r.shelf));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader eyebrow={libraryName} title="Shelves" lede="Rows of covers, the way the books sit at home." />
        <div className="flex gap-2">
          {rows.length > 1 && canAnyMove && (
            <Button type="button" variant={arranging ? "secondary" : "outline"} aria-pressed={arranging} onClick={() => setArranging((a) => !a)}>
              <Rows3 aria-hidden /> {arranging ? "Done" : "Arrange"}
            </Button>
          )}
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New shelf
          </Button>
        </div>
      </div>

      {!arranging && <ReadingRow groups={reading} />}

      {rows.length === 0 ? (
        <EmptyState
          title="No shelves yet"
          body="Shelves appear here as stacked rows of covers, one row each, so the screen looks like the wall of books in your living room."
          art={
            <div aria-hidden className="flex flex-col gap-6">
              <BlankRow count={4} />
              <BlankRow count={3} lean={2} />
            </div>
          }
        >
          <div>
            <Button type="button" onClick={() => setCreating(true)}>
              <Plus aria-hidden /> New shelf
            </Button>
          </div>
        </EmptyState>
      ) : arranging ? (
        <section aria-labelledby="arrange-h" className="flex flex-col gap-3">
          <div>
            <h2 id="arrange-h" className="text-xl font-medium">
              Arrange the rows
            </h2>
            <p className="text-sm text-muted-foreground">
              Drag the handle, or use the arrows. The order of shared shelves is shared with everyone; your private shelves are placed among them for you only.
              {role === "viewer" ? " As a viewer you can move your own private shelves." : ""}
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {ordered.map((r, i) => (
              <ArrangeRow
                key={r.shelf.id}
                row={r}
                index={i}
                total={ordered.length}
                movable={canWriteShelf(role, userId, { visibility: r.shelf.visibility, createdBy: r.shelf.createdBy })}
                drag={drag}
                onMove={move}
              />
            ))}
          </ul>
          <p role="status" aria-live="polite" className="sr-only">
            {announce}
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </section>
      ) : (
        ordered.map((r) => <ShelfRow key={r.shelf.id} row={r} />)
      )}

      {creating && (
        <ShelfFormSheet
          libraryId={libraryId}
          initial={NEW_SHELF}
          canShare={role !== "viewer"}
          onClose={(id) => {
            setCreating(false);
            if (id) router.refresh();
          }}
        />
      )}
    </div>
  );
}
