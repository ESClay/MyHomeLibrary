"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookCheck, PenLine, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Cover } from "@/components/cover";
import { mergeMetadata } from "@/lib/metadata/merge";
import type { BookMetadata } from "@/lib/metadata/types";
import { announce, type Suggestion } from "@/lib/typeahead";
import { cn } from "@/lib/utils";
import { ConfirmSheet } from "./confirm-sheet";
import { useTypeahead } from "./use-typeahead";

type Phase = "idle" | "loading" | "done" | "error";

async function fetchMetadata(params: string, signal?: AbortSignal): Promise<BookMetadata[]> {
  const res = await fetch(`/api/metadata?${params}`, { signal });
  if (!res.ok) throw new Error("search failed");
  const body = (await res.json()) as { results: BookMetadata[] };
  return body.results;
}

export function AddBook({ libraryId }: { libraryId: string }) {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [results, setResults] = useState<BookMetadata[]>([]);
  const [searched, setSearched] = useState("");
  const [picking, setPicking] = useState<number | string | null>(null);
  const [sheet, setSheet] = useState<{ candidate: BookMetadata | null } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const router = useRouter();
  const listId = useId();
  const [open, setOpen] = useState(true);
  const [activeIndex, setActiveIndex] = useState(-1);
  const typeahead = useTypeahead(query, libraryId, phase !== "loading");
  const { suggestions } = typeahead;
  const showList = open && typeahead.active && (suggestions.length > 0 || typeahead.loading || typeahead.empty);
  const optionId = (i: number) => `${listId}-opt-${i}`;
  const libraryCount = suggestions.filter((s) => s.kind === "library").length;

  useEffect(() => () => abort.current?.abort(), []);

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setOpen(false);
    setActiveIndex(-1);
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setPhase("loading");
    try {
      const found = await fetchMetadata(`q=${encodeURIComponent(q)}`, ctl.signal);
      setResults(found);
      setSearched(q);
      setPhase("done");
    } catch (err) {
      if ((err as Error).name !== "AbortError") setPhase("error");
    }
  }

  function choose(s: Suggestion) {
    setOpen(false);
    setActiveIndex(-1);
    if (s.kind === "library") {
      router.push(`/books/${s.book.id}`);
      return;
    }
    void pick(s.book, s.key);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (showList) {
        e.preventDefault(); // Keeps the browser from clearing the search field too.
        setOpen(false);
        setActiveIndex(-1);
      }
      return;
    }
    if (!showList || suggestions.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = suggestions.length;
      setActiveIndex((i) => (e.key === "ArrowDown" ? (i + 1) % n : i <= 0 ? n - 1 : i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0 && suggestions[activeIndex]) {
      e.preventDefault();
      choose(suggestions[activeIndex]);
    }
  }

  async function pick(candidate: BookMetadata, key: number | string) {
    setPicking(key);
    let chosen = candidate;
    if (candidate.isbn13) {
      try {
        // A full lookup by ISBN adds what the search listing leaves out (description, series, other covers).
        const [full] = await fetchMetadata(`isbn=${candidate.isbn13}`);
        if (full) chosen = mergeMetadata([candidate, full]) ?? candidate;
      } catch {
        // Keep the search listing's data.
      }
    }
    setPicking(null);
    setSheet({ candidate: chosen });
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={runSearch} role="search" className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            name="q"
            aria-label="Title, author or ISBN"
            placeholder="Title, author or ISBN"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActiveIndex(-1);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-activedescendant={showList && activeIndex >= 0 ? optionId(activeIndex) : undefined}
            autoComplete="off"
            enterKeyHint="search"
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={phase === "loading" || query.trim().length < 2}>
          {phase === "loading" ? "Searching…" : "Search for books"}
        </Button>
      </form>

      <p className="sr-only" role="status" aria-live="polite">
        {typeahead.active && open ? announce(libraryCount, suggestions.length - libraryCount, typeahead.loading) : ""}
      </p>
      <div
        id={listId}
        role="listbox"
        aria-label="Suggestions"
        hidden={!showList}
        className="panel -mt-3 flex flex-col overflow-hidden"
      >
        {showList && (
          <SuggestionRows
            suggestions={suggestions}
            activeIndex={activeIndex}
            optionId={optionId}
            picking={picking}
            loading={typeahead.loading}
            empty={typeahead.empty}
            onChoose={choose}
            onHover={setActiveIndex}
          />
        )}
      </div>

      <div aria-live="polite" className="flex flex-col gap-3">
        {phase === "loading" && <p className="text-sm text-muted-foreground">Looking through the catalogues…</p>}
        {phase === "error" && (
          <p role="alert" className="text-sm text-destructive">
            Search is unavailable right now. You can still add the book by hand.
          </p>
        )}
        {phase === "done" && results.length === 0 && (
          <p className="text-base text-muted-foreground">
            No books matched “{searched}”. Check the spelling, or add it by hand.
          </p>
        )}
        {phase === "done" && results.length > 0 && (
          <ul className="flex flex-col gap-2">
            {results.map((r, i) => (
              <li key={`${r.isbn13 ?? r.title}-${i}`}>
                <button
                  type="button"
                  disabled={picking !== null}
                  onClick={() => pick(r, i)}
                  className="panel flex w-full cursor-pointer items-center gap-4 p-3 text-left transition-[transform,border-color] duration-[var(--dur-fast)] hover:-translate-y-0.5 hover:border-foreground/30 active:translate-y-px disabled:opacity-60"
                >
                  <Cover url={r.covers[0]?.url ?? null} title={r.title} className="w-14 shrink-0" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-display line-clamp-2 text-lg leading-snug font-medium">{r.title}</span>
                    <span className="truncate text-sm text-muted-foreground">
                      {r.authors.join(", ") || "Unknown author"}
                      {r.publishedDate ? ` · ${r.publishedDate.slice(0, 4)}` : ""}
                    </span>
                    {r.seriesName && (
                      <span className="truncate text-sm text-gilt">
                        {r.seriesName}
                        {r.seriesPosition !== null ? ` #${r.seriesPosition}` : ""}
                      </span>
                    )}
                    {picking === i && <span className="text-xs text-muted-foreground">Loading details…</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">Not in any catalogue? Type the details yourself.</p>
        <Button type="button" variant="outline" onClick={() => setSheet({ candidate: null })}>
          <PenLine aria-hidden /> Enter a book by hand
        </Button>
      </div>

      {sheet && <ConfirmSheet key={sheet.candidate?.isbn13 ?? sheet.candidate?.title ?? "manual"} libraryId={libraryId} candidate={sheet.candidate} onClose={() => setSheet(null)} />}
    </div>
  );
}

const rowClass =
  "flex min-h-14 w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors duration-[var(--dur-fast)] aria-selected:bg-accent hover:bg-accent";

function Rows({ items, start, ...rest }: { items: Suggestion[]; start: number } & RowShared) {
  return items.map((s, i) => <Row key={s.key} s={s} index={start + i} {...rest} />);
}

type RowShared = {
  activeIndex: number;
  optionId: (i: number) => string;
  picking: number | string | null;
  onChoose: (s: Suggestion) => void;
  onHover: (i: number) => void;
};

function Row({ s, index, activeIndex, optionId, picking, onChoose, onHover }: { s: Suggestion; index: number } & RowShared) {
  const isLib = s.kind === "library";
  const title = s.book.title;
  const authors = s.book.authors.join(", ") || "Unknown author";
  const year = !isLib && s.book.publishedDate ? s.book.publishedDate.slice(0, 4) : "";
  const seriesName = s.book.seriesName;
  const seriesPos = s.book.seriesPosition;
  const cover = isLib ? s.book.coverUrl : (s.book.covers[0]?.url ?? null);
  return (
    <div
      id={optionId(index)}
      role="option"
      aria-selected={activeIndex === index}
      aria-disabled={picking !== null || undefined}
      // Keep focus in the input: mousedown would move it to the row.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => picking === null && onChoose(s)}
      onMouseMove={() => activeIndex !== index && onHover(index)}
      className={cn(rowClass, picking === s.key && "opacity-60")}
    >
      <Cover url={cover} title={title} className="w-8 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-display line-clamp-1 text-base leading-snug font-medium">{title}</span>
        <span className="truncate text-sm text-muted-foreground">
          {authors}
          {year ? ` · ${year}` : ""}
        </span>
        {seriesName && (
          <span className="truncate text-xs text-gilt">
            {seriesName}
            {seriesPos !== null ? ` #${seriesPos}` : ""}
          </span>
        )}
      </span>
      {isLib ? (
        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold tracking-[0.08em] text-gilt uppercase">
          <BookCheck aria-hidden className="size-3.5" /> In library
        </span>
      ) : (
        picking === s.key && <span className="shrink-0 text-xs text-muted-foreground">Loading…</span>
      )}
    </div>
  );
}

function SuggestionRows({
  suggestions,
  loading,
  empty,
  ...shared
}: { suggestions: Suggestion[]; loading: boolean; empty: boolean } & RowShared) {
  const lib = suggestions.filter((s) => s.kind === "library");
  const online = suggestions.filter((s) => s.kind === "online");
  return (
    <>
      {lib.length > 0 && (
        <div role="group" aria-label="In your library" className="flex flex-col">
          <Rows items={lib} start={0} {...shared} />
        </div>
      )}
      {online.length > 0 && (
        <div role="group" aria-label="Online matches" className={cn("flex flex-col", lib.length > 0 && "border-t border-border")}>
          <Rows items={online} start={lib.length} {...shared} />
        </div>
      )}
      {loading && (
        <p className={cn("px-3 py-3 text-sm text-muted-foreground", suggestions.length > 0 && "border-t border-border")}>
          Looking…
        </p>
      )}
      {empty && (
        <p className="px-3 py-4 text-sm text-muted-foreground">No matches. Try the full search or add manually.</p>
      )}
    </>
  );
}
