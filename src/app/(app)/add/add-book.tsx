"use client";

import { useEffect, useRef, useState } from "react";
import { PenLine, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Cover } from "@/components/cover";
import { mergeMetadata } from "@/lib/metadata/merge";
import type { BookMetadata } from "@/lib/metadata/types";
import { ConfirmSheet } from "./confirm-sheet";

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
  const [picking, setPicking] = useState<number | null>(null);
  const [sheet, setSheet] = useState<{ candidate: BookMetadata | null } | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
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

  async function pick(index: number) {
    const candidate = results[index];
    setPicking(index);
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
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            enterKeyHint="search"
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={phase === "loading" || query.trim().length < 2}>
          {phase === "loading" ? "Searching…" : "Search for books"}
        </Button>
      </form>

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
                  onClick={() => pick(i)}
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
