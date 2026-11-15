"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BookMetadata } from "@/lib/metadata/types";
import {
  LIBRARY_DEBOUNCE_MS,
  ONLINE_DEBOUNCE_MS,
  SuggestionCache,
  mergeSuggestions,
  normalizeQuery,
  shouldSuggest,
  type LibrarySuggestion,
  type Suggestion,
} from "@/lib/typeahead";

type Source = "library" | "online";
type Status = "idle" | "loading" | "done" | "error";

const libraryCache = new SuggestionCache<LibrarySuggestion[]>();
const onlineCache = new SuggestionCache<BookMetadata[]>();

async function fetchSource<T>(source: Source, q: string, libraryId: string, signal: AbortSignal): Promise<T[]> {
  const params = new URLSearchParams({ source, q });
  if (source === "library") params.set("library", libraryId);
  const res = await fetch(`/api/suggest?${params}`, { signal });
  if (!res.ok) throw new Error("suggest failed");
  return ((await res.json()) as { results: T[] }).results;
}

/**
 * Debounced, cancellable suggestions for the Add search. The library lookup is cheap and fires after a short
 * pause; the online lookup waits longer. Each query change aborts both requests; a response is applied only
 * if its query is still the current one. Results are cached per normalized query for the session.
 */
export function useTypeahead(rawQuery: string, libraryId: string, enabled: boolean) {
  const q = normalizeQuery(rawQuery);
  const active = enabled && shouldSuggest(rawQuery);

  // What has arrived, tagged with the query it answers.
  const [lib, setLib] = useState<{ q: string; items: LibrarySuggestion[]; status: Status }>({ q: "", items: [], status: "idle" });
  const [onl, setOnl] = useState<{ q: string; items: BookMetadata[]; status: Status }>({ q: "", items: [], status: "idle" });
  const latest = useRef(q);

  useEffect(() => {
    latest.current = q;
    if (!active) return;

    const ctl = new AbortController();
    const timers: ReturnType<typeof setTimeout>[] = [];

    function run<T>(source: Source, delay: number, cache: SuggestionCache<T[]>, set: (update: (prev: { q: string; items: T[]; status: Status }) => { q: string; items: T[]; status: Status }) => void) {
      const hit = cache.get(q);
      if (hit) {
        set(() => ({ q, items: hit, status: "done" }));
        return;
      }
      // Keep the previous results on screen while the new ones load (when the user is still refining the same
      // query), so the list does not jump. An unrelated query starts empty.
      set((prev) => ({ q, items: prev.q && (q.startsWith(prev.q) || prev.q.startsWith(q)) ? prev.items : [], status: "loading" }));
      timers.push(
        setTimeout(async () => {
          try {
            const items = await fetchSource<T>(source, q, libraryId, ctl.signal);
            cache.set(q, items);
            if (latest.current === q) set(() => ({ q, items, status: "done" }));
          } catch (e) {
            if ((e as Error).name !== "AbortError" && latest.current === q) set(() => ({ q, items: [], status: "error" }));
          }
        }, delay),
      );
    }

    run<LibrarySuggestion>("library", LIBRARY_DEBOUNCE_MS, libraryCache, setLib);
    run<BookMetadata>("online", ONLINE_DEBOUNCE_MS, onlineCache, setOnl);

    return () => {
      ctl.abort();
      timers.forEach(clearTimeout);
    };
  }, [q, active, libraryId]);

  const current = useCallback((s: { q: string; status: Status }): Status => (!active ? "idle" : s.q === q ? s.status : "loading"), [active, q]);
  const libStatus = current(lib);
  const onlStatus = current(onl);

  const suggestions: Suggestion[] = useMemo(
    () => (active ? mergeSuggestions(lib.items, onl.items) : []),
    [active, lib.items, onl.items],
  );

  return {
    active,
    suggestions,
    loading: active && (libStatus === "loading" || onlStatus === "loading"),
    /** Both lookups finished (or failed) and nothing came back. */
    empty: active && libStatus !== "loading" && onlStatus !== "loading" && suggestions.length === 0,
    onlineFailed: active && onlStatus === "error",
  };
}
