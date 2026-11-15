"use client";

import { useId, useState, type Dispatch } from "react";
import Link from "next/link";
import { BookCheck, ChevronUp, LoaderCircle, PenLine, RotateCw, ScanBarcode, X } from "lucide-react";
import { Cover } from "@/components/cover";
import { Button } from "@/components/ui/button";
import type { TrayAction, TrayItem } from "@/lib/scan/tray";
import { cn } from "@/lib/utils";

export const itemTitle = (i: TrayItem) => i.meta?.title ?? (i.overrides.title?.trim() || `ISBN ${i.isbn}`);
const inLibrary = (i: TrayItem) => !!i.duplicates && i.duplicates.length > 0;

function Thumb({ item }: { item: TrayItem }) {
  return (
    <li className="relative w-11 shrink-0" aria-hidden>
      <Cover url={item.meta?.covers[0]?.url ?? null} title={itemTitle(item)} className="w-11" />
      {item.status === "pending" && (
        <span className="absolute inset-0 flex items-center justify-center rounded-[4px] bg-background/60">
          <LoaderCircle className="size-4 animate-spin text-foreground motion-reduce:animate-none" />
        </span>
      )}
      {inLibrary(item) && (
        <span className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-gilt text-white ring-2 ring-card">
          <BookCheck className="size-3" />
        </span>
      )}
      {(item.status === "notfound" || item.status === "error") && (
        <span className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-muted-foreground text-[0.7rem] font-bold text-card ring-2 ring-card">
          ?
        </span>
      )}
    </li>
  );
}

function Row({ item, dispatch }: { item: TrayItem; dispatch: Dispatch<TrayAction> }) {
  const title = itemTitle(item);
  const authors = item.meta?.authors.join(", ");
  return (
    <li className="rise flex items-center gap-3 px-3 py-2">
      <Cover url={item.meta?.covers[0]?.url ?? null} title={title} className="w-10 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col">
        {item.status === "pending" ? (
          <>
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> Looking up…
            </p>
            <p className="truncate text-xs text-muted-foreground">ISBN {item.isbn}</p>
          </>
        ) : item.status === "found" ? (
          <>
            <p className="font-display line-clamp-2 text-base leading-snug font-medium">{title}</p>
            <p className="truncate text-sm text-muted-foreground">{authors || "Unknown author"}</p>
            {inLibrary(item) && (
              <p className="flex items-center gap-1 text-xs font-semibold tracking-[0.08em] text-gilt uppercase">
                <BookCheck aria-hidden className="size-3.5" /> In library
              </p>
            )}
          </>
        ) : item.status === "notfound" ? (
          <>
            <p className="text-sm font-medium">{inLibrary(item) ? title : "Not found"}</p>
            <p className="truncate text-xs text-muted-foreground">ISBN {item.isbn}</p>
            {inLibrary(item) ? (
              <p className="flex items-center gap-1 text-xs font-semibold tracking-[0.08em] text-gilt uppercase">
                <BookCheck aria-hidden className="size-3.5" /> In library
              </p>
            ) : (
              <Link
                href={`/add?isbn=${item.isbn}`}
                className="-ml-1 inline-flex min-h-11 w-fit items-center gap-1.5 px-1 text-sm font-medium underline decoration-gilt decoration-2 underline-offset-4 hover:decoration-foreground"
              >
                <PenLine aria-hidden className="size-3.5" /> Enter it by hand
              </Link>
            )}
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-destructive">Lookup failed</p>
            <p className="truncate text-xs text-muted-foreground">ISBN {item.isbn}</p>
            <button
              type="button"
              onClick={() => dispatch({ type: "retry", id: item.id })}
              className="-ml-1 inline-flex min-h-11 w-fit cursor-pointer items-center gap-1.5 px-1 text-sm font-medium underline decoration-gilt decoration-2 underline-offset-4 hover:decoration-foreground"
            >
              <RotateCw aria-hidden className="size-3.5" /> Try again
            </button>
          </>
        )}
      </div>
      <button
        type="button"
        aria-label={`Remove ${title} from the tray`}
        onClick={() => dispatch({ type: "remove", ids: [item.id] })}
        className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-accent hover:text-foreground"
      >
        <X aria-hidden className="size-5" />
      </button>
    </li>
  );
}

/**
 * The scan tray. On a phone it is a strip docked under the viewfinder (count, cover thumbnails) that opens
 * into the full list; from md up it is always the list, in a side panel.
 */
export function Tray({
  items,
  dispatch,
  onReview,
  storageFailed,
  className,
}: {
  items: TrayItem[];
  dispatch: Dispatch<TrayAction>;
  onReview: () => void;
  storageFailed: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const n = items.length;
  const looking = items.filter((i) => i.status === "pending").length;

  return (
    <section
      aria-label="Scan tray"
      className={cn(
        "relative z-10 flex min-h-0 flex-col rounded-t-[14px] border-t border-border bg-card pb-[env(safe-area-inset-bottom)] text-card-foreground shadow-[0_-10px_30px_-12px_rgb(0_0_0/0.5)] md:rounded-[14px] md:border md:pb-0 md:shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-3 pt-1.5 pb-1">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((v) => !v)}
          className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 text-left md:cursor-default"
        >
          <span className="font-display text-lg font-medium">Tray</span>
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-2 text-xs font-semibold text-primary-foreground tabular-nums">
            {n}
          </span>
          <span className="sr-only">{n === 1 ? "book" : "books"}</span>
          {looking > 0 && (
            <span className="truncate text-xs text-muted-foreground" aria-hidden>
              {looking} looking up
            </span>
          )}
          <ChevronUp
            aria-hidden
            className={cn("ml-auto size-5 shrink-0 text-muted-foreground transition-transform duration-[var(--dur)] md:hidden", expanded && "rotate-180")}
          />
        </button>
        <Button type="button" disabled={n === 0} onClick={onReview} className="shrink-0">
          {n === 0 ? "Review" : `Review ${n} ${n === 1 ? "book" : "books"}`}
        </Button>
      </div>

      {n > 0 && !expanded && (
        <ul
          aria-hidden
          onClick={() => setExpanded(true)}
          className="flex cursor-pointer gap-2 overflow-x-auto px-3 pt-1 pb-3 md:hidden [scrollbar-width:none]"
        >
          {items.map((i) => (
            <Thumb key={i.id} item={i} />
          ))}
        </ul>
      )}

      <div id={listId} className={cn("min-h-0 flex-col overflow-y-auto border-t border-border md:flex md:max-h-[min(60dvh,32rem)]", expanded ? "flex max-h-[50dvh]" : "hidden")}>
        {n === 0 ? (
          <div className="flex items-start gap-3 px-4 py-5 text-sm text-muted-foreground">
            <ScanBarcode aria-hidden className="mt-0.5 size-5 shrink-0" />
            <p>Scanned books collect here while the camera stays open. Nothing is saved until you review.</p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((i) => (
              <Row key={i.id} item={i} dispatch={dispatch} />
            ))}
          </ul>
        )}
        {storageFailed && n > 0 && (
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            This browser isn&apos;t keeping the tray between visits, so review it before you leave.
          </p>
        )}
      </div>
    </section>
  );
}
