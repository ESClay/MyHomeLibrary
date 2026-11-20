"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookCheck, BookmarkPlus, CheckSquare, ChevronRight, LayoutGrid, List, Loader2, Merge, PencilLine, RefreshCw, Rows3, Search, SlidersHorizontal, X } from "lucide-react";
import { BookGrid, BookList, type ViewMode } from "@/components/book-grid";
import { AssignSheet } from "@/components/assign-sheet";
import { BulkEditSheet } from "@/components/bulk-edit-sheet";
import { MergeSheet } from "@/components/merge-sheet";
import { MAX_MERGE_BOOKS, MIN_MERGE_BOOKS } from "@/lib/books/merge";
import { NEW_SHELF, ShelfFormSheet } from "@/components/shelf-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RenameAuthorSheet } from "@/components/rename-author-sheet";
import { RenameSeriesSheet } from "@/components/rename-series-sheet";
import type { AuthorVariantGroup } from "@/lib/books/author-variants";
import type { SeriesOption } from "@/lib/books/series-suggest";
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
import { refreshMetadata } from "@/app/(app)/books/actions";
import { bulkSetStatus } from "./bulk-actions";
import { MAX_REFRESH_BOOKS, classifyRefresh, emptyTally, markedReadMessage, refreshSummary } from "@/lib/books/bulk";
import { LOOKUP_GAP_MS } from "@/lib/calibre/limits";
import { loadLibraryPage, saveLibrarySort } from "./actions";
import { StatusGlyph } from "@/components/status-mark";
import { clearLeftLibrary, loadFeed, markLeftLibrary, saveFeed, saveLibraryUrl, tabStorage } from "@/lib/books/library-memory";
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

/** Bar actions after the lead one: two to a row on a phone, growing to fill each row; the label wraps rather than overflows. */
const BAR_SECONDARY = "basis-[calc(50%-0.25rem)] grow px-3 leading-tight whitespace-normal sm:basis-auto";

/** One-tap filters on the same `my` param as the "My status" select. */
const STATUS_CHIPS: { label: string; value: LibraryParams["my"]; status?: Status }[] = [
  { label: "All", value: null },
  ...STATUSES.map((s) => ({ label: STATUS_LABEL[s], value: s, status: s })),
  { label: "No status", value: "none" },
];

/**
 * Puts the page back at `y` and keeps it there for a moment: Next scrolls a freshly pushed page to the top
 * after our layout effect, so the position is re-applied until the person scrolls or the page settles.
 */
function holdScroll(y: number) {
  let touched = false;
  const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  const stop = () => {
    touched = true;
  };
  for (const e of events) window.addEventListener(e, stop, { passive: true, once: true });
  const apply = () => {
    if (!touched && Math.abs(window.scrollY - y) > 2) window.scrollTo({ top: y, behavior: "instant" });
  };
  window.scrollTo({ top: y, behavior: "instant" });
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
  window.setTimeout(() => {
    apply();
    for (const e of events) window.removeEventListener(e, stop);
  }, 300);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Feed = { sig: string; extra: LibraryItem[]; hasMore: boolean; status: "idle" | "loading" | "error" };

export function LibraryBrowser({
  items: firstPage,
  hasMore: firstHasMore,
  total,
  librarySize,
  params,
  seriesNames,
  seriesOptions,
  authorGroups,
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
  /** (series, author) pairs, so a rename can be limited to one author. */
  seriesOptions: SeriesOption[];
  /** Authors written more than one way, for the spelling line in the filters. */
  authorGroups: AuthorVariantGroup[];
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
  const [editOpen, setEditOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const [run, setRun] = useState<{ at: number; total: number } | null>(null);
  const stopRun = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopRun.current = true;
    };
  }, []);
  const canEditBooks = role === "owner" || role === "editor";
  const [smartOpen, setSmartOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [fixingAuthor, setFixingAuthor] = useState<AuthorVariantGroup | null>(null);
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
  const latest = useRef({ sig, count: items.length, params, extra: feed.extra, hasMore: feed.hasMore });
  useEffect(() => {
    latest.current = { sig, count: items.length, params, extra: feed.extra, hasMore: feed.hasMore };
  });

  // Coming back from a book: put the loaded pages back, then the scroll position (see library-memory.ts).
  const restore = useRef<{ y: number; need: number } | null>(null);
  const bookOpened = useRef(false);
  useLayoutEffect(() => {
    const store = tabStorage();
    clearLeftLibrary(store);
    const snap = loadFeed(store, sig);
    if (!snap || !snap.bookClick) return;
    const seen = new Set(firstPage.map((i) => i.id));
    const extra = snap.extra.filter((i) => !seen.has(i.id));
    restore.current = { y: snap.scrollY, need: extra.length };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- storage only exists on the client, so this can't be the initial state
    if (extra.length) setFeed((f) => (f.sig === sig ? { ...f, extra, hasMore: snap.hasMore } : f));
    // Only on arrival: later changes of the list are the person's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => {
    const r = restore.current;
    if (!r || feed.extra.length < r.need) return;
    restore.current = null;
    holdScroll(r.y);
  }, [feed.extra.length]);

  const remember = useCallback((bookClick: boolean) => {
    const l = latest.current;
    saveFeed(tabStorage(), { sig: l.sig, extra: l.extra, hasMore: l.hasMore, scrollY: window.scrollY, bookClick });
  }, []);
  useEffect(() => {
    const onHide = () => remember(true);
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [remember]);
  const here = libraryHref(params);
  useEffect(() => saveLibraryUrl(tabStorage(), here), [here]);

  /** A book link is about to open: keep the list and the position, and note that the previous page is the library. */
  function onListClickCapture(e: React.MouseEvent) {
    if (selecting || e.button !== 0) return;
    const a = (e.target as Element).closest?.('a[href^="/books/"]');
    if (!a) return;
    const newTab = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
    remember(true);
    if (newTab) return;
    bookOpened.current = true;
    markLeftLibrary(tabStorage());
  }

  // Status chips: which sides of the row have more to scroll to.
  const chipRow = useRef<HTMLDivElement>(null);
  const [chipMore, setChipMore] = useState({ left: false, right: false });
  useEffect(() => {
    const el = chipRow.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 4;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
      setChipMore((m) => (m.left === left && m.right === right ? m : { left, right }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  function nudgeChips() {
    const el = chipRow.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: el.clientWidth * 0.7, behavior: reduce ? "auto" : "smooth" });
  }

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

  /** Sets "my status" to Read on the selection. Status only: no dated read entry. */
  async function markSelectedRead() {
    const ids = [...selected];
    if (ids.length === 0 || marking || run) return;
    setNotice(null);
    setMarking(true);
    let res: Awaited<ReturnType<typeof bulkSetStatus>>;
    try {
      res = await bulkSetStatus({ libraryId, bookIds: ids, status: "read" });
    } catch {
      res = { ok: false, error: "Could not update the status." };
    }
    if (!mounted.current) return;
    setMarking(false);
    if (!res.ok) {
      setNotice(res.error);
      return;
    }
    setNotice(markedReadMessage(ids.length));
    stopSelecting();
    router.refresh();
  }

  /** Pulls metadata for the selection, one book at a time, paced for the catalogue's rate limit. */
  async function refreshSelected() {
    const ids = [...selected];
    if (ids.length === 0 || run) return;
    if (ids.length > MAX_REFRESH_BOOKS) {
      setNotice(`Refresh metadata handles ${MAX_REFRESH_BOOKS} books at a time. You selected ${ids.length}, so narrow the selection and try again.`);
      return;
    }
    setNotice(null);
    stopRun.current = false;
    const tally = emptyTally();
    let denied: string | null = null;
    let stopped = false;
    for (let i = 0; i < ids.length; i++) {
      if (stopRun.current) {
        stopped = true;
        break;
      }
      if (!mounted.current) return;
      setRun({ at: i + 1, total: ids.length });
      let outcome: ReturnType<typeof classifyRefresh>;
      try {
        const res = await refreshMetadata(ids[i]);
        outcome = classifyRefresh(res);
        if (!res.ok && res.code === "full_access_required") denied = res.error;
      } catch {
        outcome = "failed";
      }
      if (outcome === "denied") break;
      tally[outcome] += 1;
      if (i < ids.length - 1 && !stopRun.current) await sleep(LOOKUP_GAP_MS);
    }
    if (!mounted.current) return;
    setRun(null);
    router.refresh();
    setNotice(refreshSummary(tally, { stopped, denied }));
    stopSelecting();
  }

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
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top)+1px)] z-20 -mx-4 flex flex-col gap-1 bg-background/95 px-4 pt-1.5 pb-2 backdrop-blur after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-3 after:bg-gradient-to-b after:from-background/90 after:to-transparent md:top-0 md:-mx-10 md:px-10 md:pt-2">
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

      <div className="relative -mx-4 md:mx-0">
      <div
        ref={chipRow}
        role="group"
        aria-label="My reading status"
        style={{ "--fade-l": chipMore.left ? "2.5rem" : "0px", "--fade-r": chipMore.right ? "3.5rem" : "0px" } as React.CSSProperties}
        className="flex snap-x snap-proximity scroll-px-4 gap-2 overflow-x-auto overscroll-x-contain px-4 [mask-image:linear-gradient(to_right,transparent_0,black_var(--fade-l),black_calc(100%-var(--fade-r)),transparent_100%)] [scrollbar-width:none] md:px-0 md:[mask-image:none] [&::-webkit-scrollbar]:hidden"
      >
        {STATUS_CHIPS.map((c) => {
          const active = (params.my ?? null) === c.value;
          return (
            <button
              key={c.label}
              type="button"
              aria-pressed={active}
              onClick={() => go({ my: c.value })}
              className={cn(
                "inline-flex h-11 shrink-0 snap-start cursor-pointer items-center gap-1.5 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color] duration-[var(--dur-fast)] outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                active ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-foreground hover:border-foreground/40 hover:bg-accent",
              )}
            >
              {c.status && <StatusGlyph status={c.status} className="size-3.5" />}
              {c.label}
            </button>
          );
        })}
      </div>
      {chipMore.right && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={nudgeChips}
          className="group absolute top-0 right-0 flex size-11 cursor-pointer items-center justify-center outline-none md:hidden"
        >
          <span className="flex size-8 items-center justify-center rounded-full border border-input bg-card text-foreground shadow-sm transition-[background-color,transform] duration-[var(--dur-fast)] group-hover:bg-accent group-active:scale-95 motion-reduce:transition-none">
            <ChevronRight className="size-4" aria-hidden />
          </span>
        </button>
      )}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:gap-x-3">
        <p role="status" aria-live="polite" className={cn("order-first basis-full max-sm:pt-2 text-xs text-muted-foreground transition-opacity sm:order-none sm:mr-auto sm:basis-auto sm:text-sm", pending && "opacity-50")}>
          {total === librarySize ? `${total} ${total === 1 ? "book" : "books"}` : `${total} of ${librarySize} books`}
        </p>
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm sm:flex-none [&>div]:min-w-0 [&>div]:flex-1 sm:[&>div]:w-44 sm:[&>div]:flex-none">
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
            className="w-full text-sm"
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
            <CheckSquare aria-hidden /> <span className="max-sm:sr-only">{selecting ? "Done" : "Select"}</span>
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
                "flex size-11 cursor-pointer items-center justify-center rounded-md transition-colors duration-[var(--dur-fast)]",
                view === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
            </button>
          ))}
        </div>
      </div>
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
          <div className="flex min-w-0 flex-col gap-1.5">
            <FilterSelect label="Series" value={params.series ?? ""} onChange={(v) => go({ series: v || null })}>
              <option value="">Any</option>
              {seriesNames.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </FilterSelect>
            {canEditBooks && params.series && (
              <Button type="button" variant="outline" size="sm" className="h-11 w-fit" onClick={() => setRenaming(true)}>
                <PencilLine aria-hidden /> Rename series
              </Button>
            )}
          </div>
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
          {authorGroups.length > 0 && (
            <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-3">
              <p className="text-sm font-semibold">
                {authorGroups.length === 1 ? "1 author is" : `${authorGroups.length} authors are`} spelled more than one way
              </p>
              <ul className="flex flex-col gap-1">
                {authorGroups.map((g) => (
                  <li key={g.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 text-sm text-muted-foreground">{g.spellings.map((s) => s.name).join(" / ")}</span>
                    {canEditBooks && (
                      <Button type="button" variant="outline" size="sm" className="h-11" onClick={() => setFixingAuthor(g)}>
                        <PencilLine aria-hidden /> Fix spelling
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
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

      {notice && (
        <p role="status" className="panel px-4 py-3 text-sm">
          {notice}
        </p>
      )}

      {fixingAuthor && (
        <RenameAuthorSheet
          libraryId={libraryId}
          author={fixingAuthor.spellings[fixingAuthor.spellings.length - 1].name}
          suggested={fixingAuthor.spellings[0].name}
          groups={authorGroups}
          onClose={() => setFixingAuthor(null)}
          onDone={(message) => {
            setNotice(message);
            startTransition(() => router.refresh());
          }}
        />
      )}

      {renaming && params.series && (
        <RenameSeriesSheet
          libraryId={libraryId}
          series={params.series}
          options={seriesOptions}
          onClose={() => setRenaming(false)}
          onDone={(newName, message) => {
            setNotice(message);
            startTransition(() => {
              router.replace(hrefFor({ series: newName }), { scroll: false });
              router.refresh();
            });
          }}
        />
      )}

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
        <div onClickCapture={onListClickCapture}>
          <BookGrid items={items} pending={pending} selection={selection} />
        </div>
      ) : (
        <div onClickCapture={onListClickCapture}>
          <BookList items={items} pending={pending} selection={selection} />
        </div>
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

      {selecting && (
        <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 flex flex-col gap-2 rounded-[14px] border border-border bg-card p-3 shadow-[var(--shadow-card)] md:bottom-4">
          <div className="flex items-center justify-between gap-3">
            <p role="status" aria-live="polite" className="text-sm font-medium">
              {selected.size === 0 ? "Tap books to select them" : `${selected.size} selected`}
            </p>
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="sm" disabled={!!run || marking} onClick={() => setSelected(new Set(items.map((i) => i.id)))}>
                Select shown
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={selected.size === 0 || !!run || marking} onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          </div>
          {run ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm font-medium">
                  <RefreshCw aria-hidden className="size-4 animate-spin text-gilt motion-reduce:animate-none" />
                  Refreshing {run.at} of {run.total}
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => (stopRun.current = true)}>
                  Stop
                </Button>
              </div>
              <div
                role="progressbar"
                aria-label="Metadata refresh"
                aria-valuemin={0}
                aria-valuemax={run.total}
                aria-valuenow={run.at}
                className="h-1 overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full rounded-full bg-gilt transition-[width] duration-[var(--dur-fast)]" style={{ width: `${(run.at / run.total) * 100}%` }} />
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" className="basis-full" disabled={selected.size === 0 || marking} onClick={() => void markSelectedRead()}>
                {marking ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <BookCheck aria-hidden />}
                {marking ? "Marking as read" : "Mark as read"}
              </Button>
              <Button type="button" variant="outline" className={BAR_SECONDARY} disabled={selected.size === 0 || marking} onClick={() => setEditOpen(true)}>
                <PencilLine aria-hidden /> Edit selected
              </Button>
              <Button type="button" variant="outline" className={BAR_SECONDARY} disabled={selected.size === 0 || marking} onClick={() => setAssign("add")}>
                Add to shelf
              </Button>
              <Button type="button" variant="outline" className={BAR_SECONDARY} disabled={selected.size === 0 || marking} onClick={() => setAssign("remove")}>
                Remove from shelf
              </Button>
              {canEditBooks && selected.size >= MIN_MERGE_BOOKS && selected.size <= MAX_MERGE_BOOKS && (
                <Button type="button" variant="outline" className={BAR_SECONDARY} disabled={marking} onClick={() => setMergeOpen(true)}>
                  <Merge aria-hidden /> Merge
                </Button>
              )}
              {canEditBooks && (
                <Button type="button" variant="outline" className={BAR_SECONDARY} disabled={selected.size === 0 || marking} onClick={() => void refreshSelected()}>
                  <RefreshCw aria-hidden /> Refresh<span className="sr-only sm:not-sr-only"> metadata</span>
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {editOpen && (
        <BulkEditSheet
          libraryId={libraryId}
          bookIds={[...selected]}
          canEditCopies={canEditBooks}
          onClose={() => setEditOpen(false)}
          onDone={(m) => {
            setNotice(m);
            stopSelecting();
          }}
        />
      )}

      {mergeOpen && (
        <MergeSheet
          libraryId={libraryId}
          bookIds={[...selected]}
          onClose={() => setMergeOpen(false)}
          onDone={(m) => {
            setNotice(m);
            stopSelecting();
          }}
        />
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
