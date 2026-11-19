"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookmarkPlus, CheckSquare, LayoutGrid, List, Loader2, Rows3, Search, SlidersHorizontal, X } from "lucide-react";
import { BookGrid, BookList, type ViewMode } from "@/components/book-grid";
import { AssignSheet } from "@/components/assign-sheet";
import { NEW_SHELF, ShelfFormSheet } from "@/components/shelf-form";
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
  type Status,
} from "@/lib/books/constants";
import {
  LOAN_FILTERS,
  LOAN_FILTER_LABEL,
  SORTS,
  SORT_LABEL,
  activeFilterCount,
  defaultDir,
  libraryHref,
  paramsToRaw,
  type LibraryItem,
  type LibraryParams,
  type LoanFilter,
  type Sort,
} from "@/lib/books/library-query";
import type { LibraryRole } from "@/lib/library";
import { rulesFromParams } from "@/lib/shelves/rules";
import { updateShelf } from "@/app/(app)/shelves/actions";
import { loadLibraryPage, saveLibrarySort } from "./actions";
import { cn } from "@/lib/utils";

export type { ViewMode };
export const VIEW_COOKIE = "library_view";

function saveView(view: ViewMode) {
  try {
    document.cookie = `${VIEW_COOKIE}=${view}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // Cookies blocked: the choice just won't be remembered.
  }
}

/** Start loading the next page this far before the end of the list. */
const LOAD_AHEAD = "800px";

type Feed = { sig: string; extra: LibraryItem[]; hasMore: boolean; status: "idle" | "loading" | "error" };

export function LibraryBrowser({
  items: firstPage,
  hasMore: firstHasMore,
  total,
  librarySize,
  params,
  seriesNames,
  hasPartners,
  initialView,
  libraryId,
  role,
  editShelf,
}: {
  /** The first page of matches; later pages are fetched as the person scrolls. */
  items: LibraryItem[];
  hasMore: boolean;
  total: number;
  librarySize: number;
  params: LibraryParams;
  seriesNames: string[];
  hasPartners: boolean;
  initialView: ViewMode;
  libraryId: string;
  role: LibraryRole;
  /** Set when the filters are being edited as a smart shelf's rules. */
  editShelf: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<ViewMode>(initialView);
  const [panelOpen, setPanelOpen] = useState(activeFilterCount(params) > 0);
  const [q, setQ] = useState(params.q);
  const lastPushed = useRef(params.q);
  const filters = activeFilterCount(params);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [assign, setAssign] = useState<"add" | "remove" | null>(null);
  const [smartOpen, setSmartOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const hasRules = filters > 0 || !!params.q;

  // Pages after the first. Whatever the server sends (new filters, sort or search) starts the list again from its first page.
  const sig = `${JSON.stringify(paramsToRaw(params))}|${total}|${firstPage.map((i) => i.id).join(",")}`;
  const [feed, setFeed] = useState<Feed>({ sig, extra: [], hasMore: firstHasMore, status: "idle" });
  if (feed.sig !== sig) setFeed({ sig, extra: [], hasMore: firstHasMore, status: "idle" });
  const items = feed.extra.length ? [...firstPage, ...feed.extra] : firstPage;
  const sentinel = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const latest = useRef({ sig, count: items.length, params });
  useEffect(() => {
    latest.current = { sig, count: items.length, params };
  });

  const loadMore = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const asked = latest.current;
    setFeed((f) => (f.sig === asked.sig ? { ...f, status: "loading" } : f));
    let res: Awaited<ReturnType<typeof loadLibraryPage>>;
    try {
      res = await loadLibraryPage({ libraryId, params: asked.params, offset: asked.count });
    } catch {
      res = { ok: false, error: "Could not load more books." };
    }
    inFlight.current = false;
    setFeed((f) => {
      if (f.sig !== asked.sig) return f; // The filters changed while this was loading: drop it.
      if (!res.ok) return { ...f, status: "error" };
      const seen = new Set([...firstPage, ...f.extra].map((i) => i.id));
      return { ...f, extra: [...f.extra, ...res.items.filter((i) => !seen.has(i.id))], hasMore: res.hasMore, status: "idle" };
    });
  }, [libraryId, firstPage]);

  // Watches the end of the list. Re-created after each page so a sentinel that is still in view fires again.
  const canObserve = feed.hasMore && feed.status === "idle";
  useEffect(() => {
    const el = sentinel.current;
    if (!canObserve || !el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void loadMore(), { rootMargin: `0px 0px ${LOAD_AHEAD} 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [canObserve, items.length, loadMore]);

  // Keeps the "editing a shelf's rules" mode across every filter change.
  const hrefFor = (o: Partial<LibraryParams> = {}) => {
    const h = libraryHref(params, o);
    return editShelf ? `${h}${h.includes("?") ? "&" : "?"}editShelf=${editShelf.id}` : h;
  };

  function go(overrides: Partial<LibraryParams>) {
    // Changing a filter or the sort starts again from the first page.
    startTransition(() => router.replace(hrefFor(overrides), { scroll: false }));
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selection = { on: selecting, selected, toggle };
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  function saveRules() {
    if (!editShelf) return;
    setRuleError(null);
    startTransition(async () => {
      const res = await updateShelf({ shelfId: editShelf.id, rules: rulesFromParams(params) });
      if (!res.ok) return setRuleError(res.error);
      router.push(`/shelves/${editShelf.id}`);
    });
  }

  // Search as you type, after a short pause.
  useEffect(() => {
    if (q === lastPushed.current) return;
    const t = setTimeout(() => {
      lastPushed.current = q;
      startTransition(() => router.replace(hrefFor({ q: q.trim() }), { scroll: false }));
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, params, router]);

  const clearAll = hrefFor({
    my: null,
    partner: null,
    format: null,
    own: null,
    series: null,
    loan: null,
    rating: null,
    q: "",
  });

  return (
    <div className="flex flex-col gap-5">
      {editShelf && (
        <section aria-label="Editing smart shelf rules" className="panel flex flex-col gap-3 border-gilt p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[0.9375rem]">
            <span className="eyebrow block text-gilt">Editing rules</span>
            Set the filters below, then save them to <span className="font-semibold">{editShelf.name}</span>.
          </p>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={`/shelves/${editShelf.id}`}>Cancel</Link>
            </Button>
            <Button type="button" disabled={pending || !hasRules} onClick={saveRules}>
              Save rules
            </Button>
          </div>
          {ruleError && (
            <p role="alert" className="text-sm text-destructive sm:basis-full">
              {ruleError}
            </p>
          )}
        </section>
      )}
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
          <FilterSelect label="Owned or wishlist" value={params.own ?? ""} onChange={(v) => go({ own: (v || null) as LibraryParams["own"] })}>
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
          <FilterSelect label="Lending" value={params.loan ?? ""} onChange={(v) => go({ loan: (v || null) as LoanFilter | null })}>
            <option value="">Any</option>
            {LOAN_FILTERS.map((l) => (
              <option key={l} value={l}>
                {LOAN_FILTER_LABEL[l]}
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
            onChange={(e) => {
              const sort = e.target.value as Sort;
              const dir = defaultDir(sort);
              go({ sort, dir });
              void saveLibrarySort({ sort, dir }).catch(() => {});
            }}
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
          onClick={() => {
            const dir = params.dir === "asc" ? "desc" : "asc";
            go({ dir });
            void saveLibrarySort({ sort: params.sort, dir }).catch(() => {});
          }}
        >
          <span aria-hidden className="text-lg leading-none">{params.dir === "asc" ? "↑" : "↓"}</span>
        </Button>
        {!editShelf && hasRules && (
          <Button type="button" variant="outline" onClick={() => setSmartOpen(true)}>
            <BookmarkPlus aria-hidden /> <span className="hidden sm:inline">Save as smart shelf</span>
            <span className="sr-only sm:hidden">Save as smart shelf</span>
          </Button>
        )}
        {!editShelf && (
          <Button type="button" variant={selecting ? "secondary" : "outline"} aria-pressed={selecting} onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
            <CheckSquare aria-hidden /> {selecting ? "Done" : "Select"}
          </Button>
        )}
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
        <BookGrid items={items} pending={pending} selection={selection} />
      ) : (
        <BookList items={items} pending={pending} selection={selection} />
      )}

      {items.length > 0 && (
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
          {!feed.hasMore && total > firstPage.length && <p>That is all {total} books.</p>}
        </div>
      )}

      {notice && (
        <p role="status" className="panel px-4 py-3 text-sm">
          {notice}
        </p>
      )}

      {selecting && (
        <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 flex flex-col gap-2 rounded-[14px] border border-border bg-card p-3 shadow-[var(--shadow-card)] md:bottom-4">
          <div className="flex items-center justify-between gap-3">
            <p role="status" aria-live="polite" className="text-sm font-medium">
              {selected.size === 0 ? "Tap books to select them" : `${selected.size} selected`}
            </p>
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set(items.map((i) => i.id)))}>
                Select shown
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={selected.size === 0} onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" disabled={selected.size === 0} onClick={() => setAssign("add")}>
              Add to shelf
            </Button>
            <Button type="button" variant="outline" disabled={selected.size === 0} onClick={() => setAssign("remove")}>
              Remove from shelf
            </Button>
          </div>
        </div>
      )}

      {assign && (
        <AssignSheet
          mode={assign}
          libraryId={libraryId}
          bookIds={[...selected]}
          onClose={() => setAssign(null)}
          onDone={(m) => {
            setNotice(m);
            stopSelecting();
          }}
        />
      )}
      {smartOpen && (
        <ShelfFormSheet
          libraryId={libraryId}
          initial={NEW_SHELF}
          rules={rulesFromParams(params)}
          canShare={role !== "viewer"}
          onClose={(id) => {
            setSmartOpen(false);
            if (id) router.push(`/shelves/${id}`);
          }}
        />
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
