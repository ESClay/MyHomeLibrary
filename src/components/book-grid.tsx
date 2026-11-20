"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { Cover } from "@/components/cover";
import { Stars } from "@/components/stars";
import { CoverLoanTag, LoanLine, LoanTag } from "@/components/loan-badge";
import { Badge } from "@/components/ui/badge";
import { primaryLoan } from "@/lib/loans/rules";
import { CoverStatusMark, InlineStatusMark } from "@/components/status-mark";
import type { LibraryItem } from "@/lib/books/library-query";
import { cn } from "@/lib/utils";

export type ViewMode = "grid" | "list";

/** Multi-select state shared by the library and a shelf. When `on`, a tap toggles instead of opening the book. */
export type Selection = { on: boolean; selected: ReadonlySet<string>; toggle: (id: string) => void };

function SelectMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-6 items-center justify-center rounded-full border-2 transition-colors duration-[var(--dur-fast)]",
        checked ? "border-primary bg-primary text-primary-foreground" : "border-white/90 bg-black/30 text-transparent",
      )}
    >
      <Check className="size-3.5" strokeWidth={3} />
    </span>
  );
}

/** Wraps a book in a link, or in a toggle button while selecting. */
function Tile({ book, selection, className, children }: { book: LibraryItem; selection?: Selection; className: string; children: React.ReactNode }) {
  if (selection?.on) {
    const checked = selection.selected.has(book.id);
    return (
      <button type="button" aria-pressed={checked} onClick={() => selection.toggle(book.id)} className={cn(className, "cursor-pointer text-left", checked && "bg-primary/5")}>
        {children}
      </button>
    );
  }
  return (
    <Link href={`/books/${book.id}`} className={className}>
      {children}
    </Link>
  );
}

export function BookGrid({ items, pending, selection, extra }: { items: LibraryItem[]; pending?: boolean; selection?: Selection; extra?: (b: LibraryItem) => React.ReactNode }) {
  return (
    <ul className={cn("grid grid-cols-3 gap-x-3 gap-y-6 transition-opacity sm:grid-cols-4 sm:gap-x-5 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7", pending && "opacity-60")}>
      {items.map((b, i) => (
        <li key={b.id}>
          <Tile book={b} selection={selection} className="group flex w-full flex-col gap-2 rounded-md outline-offset-4">
            <div className="relative">
              <Cover url={b.coverUrl} title={b.title} author={b.authors[0]} priority={i < 6} sizes="(min-width: 1024px) 160px, (min-width: 768px) 17vw, (min-width: 640px) 24vw, 31vw" />
              {selection?.on && (
                <span className="absolute top-1.5 right-1.5">
                  <SelectMark checked={selection.selected.has(b.id)} />
                </span>
              )}
              {b.ownership === "wishlist" && (
                <span className="absolute top-1.5 left-1.5 rounded-[3px] bg-gilt px-1.5 py-0.5 text-[0.625rem] font-semibold tracking-wider text-background uppercase">Wishlist</span>
              )}
              {primaryLoan(b.loans) && !selection?.on && <CoverLoanTag loan={primaryLoan(b.loans)!} />}
              <CoverStatusMark status={b.mine?.status} />
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="line-clamp-2 text-sm leading-snug font-medium group-hover:underline group-hover:decoration-gilt group-hover:underline-offset-2">{b.title}</span>
              <span className="truncate text-xs text-muted-foreground">{b.authors[0] ?? "Unknown author"}</span>
              {b.mine?.rating != null && <Stars value={b.mine.rating} size={12} />}
              {primaryLoan(b.loans) && <LoanLine loan={primaryLoan(b.loans)!} />}
              {extra?.(b)}
            </div>
          </Tile>
        </li>
      ))}
    </ul>
  );
}

export function BookList({ items, pending, selection }: { items: LibraryItem[]; pending?: boolean; selection?: Selection }) {
  return (
    <ul className={cn("panel divide-y divide-border overflow-hidden transition-opacity", pending && "opacity-60")}>
      {items.map((b) => (
        <li key={b.id}>
          <Tile book={b} selection={selection} className="flex min-h-[4.5rem] w-full items-center gap-3 px-3 py-2 transition-colors duration-[var(--dur-fast)] hover:bg-accent/60">
            {selection?.on && (
              <span className="shrink-0">
                <SelectMark checked={selection.selected.has(b.id)} />
              </span>
            )}
            <Cover url={b.coverUrl} title={b.title} author={b.authors[0]} className="w-10 shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[0.9375rem] font-medium">{b.title}</span>
              <span className="truncate text-sm text-muted-foreground">
                {b.authors[0] ?? "Unknown author"}
                {b.seriesName ? ` · ${b.seriesName}${b.seriesPosition !== null ? ` #${b.seriesPosition}` : ""}` : ""}
              </span>
              {primaryLoan(b.loans) && <LoanLine loan={primaryLoan(b.loans)!} />}
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              {b.mine?.rating != null ? <Stars value={b.mine.rating} size={12} /> : null}
              {primaryLoan(b.loans) && <LoanTag loan={primaryLoan(b.loans)!} />}
              {b.ownership === "wishlist" && <Badge variant="secondary">Wishlist</Badge>}
              <InlineStatusMark status={b.mine?.status} />
            </span>
          </Tile>
        </li>
      ))}
    </ul>
  );
}
