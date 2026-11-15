"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, LayoutGrid, List, Rows3, Search, SlidersHorizontal, X } from "lucide-react";
import { Cover } from "@/components/cover";
import { Stars } from "@/components/stars";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  FORMATS,
  FORMAT_LABEL,
  OWNERSHIP_LABEL,
  STATUSES,
  STATUS_LABEL,
  type Format,
  type Ownership,
  type Status,
} from "@/lib/books/constants";
import {
  PAGE_SIZE,
  SORTS,
  SORT_LABEL,
  activeFilterCount,
  defaultDir,
  libraryHref,
  type LibraryItem,
  type LibraryParams,
  type Sort,
} from "@/lib/books/library-query";
import { cn } from "@/lib/utils";

export type ViewMode = "grid" | "list";
export const VIEW_COOKIE = "library_view";

function saveView(view: ViewMode) {
  try {
    document.cookie = `${VIEW_COOKIE}=${view}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // Cookies blocked: the choice just won't be remembered.
  }
}

export function LibraryBrowser({
  items,
  total,
  librarySize,
  params,
  seriesNames,
  hasPartners,
  initialView,
}: {
  items: LibraryItem[];
  total: number;
  librarySize: number;
  params: LibraryParams;
  seriesNames: string[];
  hasPartners: boolean;
  initialView: ViewMode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<ViewMode>(initialView);
  const [panelOpen, setPanelOpen] = useState(activeFilterCount(params) > 0);
  const [q, setQ] = useState(params.q);
  const lastPushed = useRef(params.q);
  const filters = activeFilterCount(params);

  function go(overrides: Partial<LibraryParams>) {
    // Changing a filter or the sort starts again from the first page.
    startTransition(() => router.replace(libraryHref(params, { limit: PAGE_SIZE, ...overrides }), { scroll: false }));
  }

  // Search as you type, after a short pause.
  useEffect(() => {
    if (q === lastPushed.current) return;
    const t = setTimeout(() => {
      lastPushed.current = q;
      startTransition(() => router.replace(libraryHref(params, { q: q.trim(), limit: PAGE_SIZE }), { scroll: false }));
    }, 350);
    return () => clearTimeout(t);
  }, [q, params, router]);

  const clearAll = libraryHref(params, {
    my: null,
    partner: null,
    format: null,
    own: null,
    series: null,
    rating: null,
    q: "",
    limit: PAGE_SIZE,
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-2">
        <form role="search" className="relative flex-1" onSubmit={(e) => e.preventDefault()}>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search title, author or series"
            placeholder="Search title, author or series"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            enterKeyHint="search"
            autoComplete="off"
            className="pl-9"
          />
        </form>
        <Button
          type="button"
          variant={filters > 0 ? "secondary" : "outline"}
          aria-expanded={panelOpen}
          aria-controls="library-filters"
          onClick={() => setPanelOpen((o) => !o)}
        >
          <SlidersHorizontal aria-hidden />
          <span className="hidden sm:inline">Filters</span>
          <span className="sr-only sm:hidden">Filters</span>
          {filters > 0 && <Badge className="ml-0.5">{filters}</Badge>}
        </Button>
      </div>

      {panelOpen && (
        <section id="library-filters" aria-label="Filters" className="panel grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <FilterSelect label="My status" value={params.my ?? ""} onChange={(v) => go({ my: (v || null) as LibraryParams["my"] })}>
            <option value="">Any</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
            <option value="none">No status yet</option>
          </FilterSelect>
          {hasPartners && (
            <FilterSelect label="Partner status" value={params.partner ?? ""} onChange={(v) => go({ partner: (v || null) as Status | null })}>
              <option value="">Any</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </FilterSelect>
          )}
          <FilterSelect label="Format" value={params.format ?? ""} onChange={(v) => go({ format: (v || null) as Format | null })}>
            <option value="">Any</option>
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABEL[f]}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Owned or wishlist" value={params.own ?? ""} onChange={(v) => go({ own: (v || null) as Ownership | null })}>
            <option value="">Both</option>
            <option value="owned">{OWNERSHIP_LABEL.owned}</option>
            <option value="wishlist">{OWNERSHIP_LABEL.wishlist}</option>
          </FilterSelect>
          <FilterSelect label="Series" value={params.series ?? ""} onChange={(v) => go({ series: v || null })}>
            <option value="">Any</option>
            {seriesNames.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="My rating"
            value={params.rating === null ? "" : String(params.rating)}
            onChange={(v) => go({ rating: v === "" ? null : v === "unrated" ? "unrated" : Number(v) })}
          >
            <option value="">Any</option>
            {[5, 4.5, 4, 3.5, 3, 2].map((r) => (
              <option key={r} value={r}>
                {r} stars and up
              </option>
            ))}
            <option value="unrated">Not rated yet</option>
          </FilterSelect>
          {filters > 0 && (
            <div className="sm:col-span-2 lg:col-span-3">
              <Button asChild variant="ghost" size="sm" className="h-11">
                <Link href={clearAll} scroll={false}>
                  <X aria-hidden /> Clear filters
                </Link>
              </Button>
            </div>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p role="status" aria-live="polite" className={cn("mr-auto text-sm text-muted-foreground transition-opacity", pending && "opacity-50")}>
          {total === librarySize ? `${total} ${total === 1 ? "book" : "books"}` : `${total} of ${librarySize} books`}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only sm:not-sr-only text-muted-foreground">Sort by</span>
          <NativeSelect
            aria-label="Sort by"
            value={params.sort}
            onChange={(e) => go({ sort: e.target.value as Sort, dir: defaultDir(e.target.value as Sort) })}
            className="w-44 text-sm"
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={params.dir === "asc" ? "Ascending. Switch to descending" : "Descending. Switch to ascending"}
          onClick={() => go({ dir: params.dir === "asc" ? "desc" : "asc" })}
        >
          <span aria-hidden className="text-lg leading-none">{params.dir === "asc" ? "↑" : "↓"}</span>
        </Button>
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
              onClick={() => {
                setView(mode);
                saveView(mode);
              }}
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

      {items.length === 0 ? (
        <div className="panel flex flex-col items-start gap-3 p-6">
          <Rows3 className="size-6 text-muted-foreground" aria-hidden />
          <h2 className="text-xl font-medium">No books match</h2>
          <p className="text-muted-foreground">Try a different search, or clear the filters.</p>
          <Button asChild variant="outline">
            <Link href={clearAll} scroll={false}>
              Clear search and filters
            </Link>
          </Button>
        </div>
      ) : view === "grid" ? (
        <ul className={cn("grid grid-cols-3 gap-x-3 gap-y-6 transition-opacity sm:grid-cols-4 sm:gap-x-5 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7", pending && "opacity-60")}>
          {items.map((b, i) => (
            <li key={b.id}>
              <Link href={`/books/${b.id}`} className="group flex flex-col gap-2 rounded-md outline-offset-4">
                <div className="relative">
                  <Cover url={b.coverUrl} title={b.title} author={b.authors[0]} priority={i < 6} />
                  {b.ownership === "wishlist" && (
                    <span className="absolute top-1.5 left-1.5 rounded-[3px] bg-gilt px-1.5 py-0.5 text-[0.625rem] font-semibold tracking-wider text-background uppercase">
                      Wishlist
                    </span>
                  )}
                  {b.mine?.status === "read" && (
                    <span className="absolute right-1.5 bottom-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground" title="Read">
                      <Check className="size-3" aria-label="Read" />
                    </span>
                  )}
                </div>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="line-clamp-2 text-sm leading-snug font-medium group-hover:underline group-hover:decoration-gilt group-hover:underline-offset-2">{b.title}</span>
                  <span className="truncate text-xs text-muted-foreground">{b.authors[0] ?? "Unknown author"}</span>
                  {b.mine?.rating != null && <Stars value={b.mine.rating} size={12} />}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ul className={cn("panel divide-y divide-border overflow-hidden transition-opacity", pending && "opacity-60")}>
          {items.map((b) => (
            <li key={b.id}>
              <Link href={`/books/${b.id}`} className="flex min-h-[4.5rem] items-center gap-3 px-3 py-2 transition-colors duration-[var(--dur-fast)] hover:bg-accent/60">
                <Cover url={b.coverUrl} title={b.title} author={b.authors[0]} className="w-10 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[0.9375rem] font-medium">{b.title}</span>
                  <span className="truncate text-sm text-muted-foreground">
                    {b.authors[0] ?? "Unknown author"}
                    {b.seriesName ? ` · ${b.seriesName}${b.seriesPosition !== null ? ` #${b.seriesPosition}` : ""}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {b.mine?.rating != null ? <Stars value={b.mine.rating} size={12} /> : null}
                  {b.ownership === "wishlist" ? (
                    <Badge variant="secondary">Wishlist</Badge>
                  ) : b.mine ? (
                    <span className="text-xs text-muted-foreground">{STATUS_LABEL[b.mine.status]}</span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {total > items.length && (
        <div className="flex justify-center pt-2">
          <Button asChild variant="outline" size="lg">
            <Link href={libraryHref(params, { limit: params.limit + PAGE_SIZE })} scroll={false}>
              Show {Math.min(PAGE_SIZE, total - items.length)} more
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </NativeSelect>
    </label>
  );
}
