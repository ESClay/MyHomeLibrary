"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { checkDuplicates } from "@/app/(app)/books/actions";
import type { BookMetadata } from "@/lib/metadata/types";
import { createLimiter } from "@/lib/scan/limiter";
import { loadTray, pendingWork, saveTray, trayReducer, type TrayDuplicate, type TrayItem } from "@/lib/scan/tray";

/** Providers are rate limited, so lookups run a few at a time. */
export const LOOKUP_CONCURRENCY = 3;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Whether localStorage can be written at all (private modes and blocked storage cannot). */
function storageWorks(): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem("mhl.probe", "1");
    s.removeItem("mhl.probe");
    return true;
  } catch {
    return false;
  }
}

/** randomUUID needs a secure context; a LAN address over http has none. */
function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function fetchByIsbn(isbn: string, signal: AbortSignal): Promise<BookMetadata | null> {
  const res = await fetch(`/api/metadata?isbn=${isbn}`, { signal });
  if (!res.ok) throw new Error("lookup failed");
  const body = (await res.json()) as { results: BookMetadata[] };
  return body.results[0] ?? null;
}

async function findDuplicates(libraryId: string, isbn: string, meta: BookMetadata | null): Promise<TrayDuplicate[]> {
  try {
    const res = await checkDuplicates({
      libraryId,
      // An unknown book can still match on ISBN, so give the check something to hold.
      title: meta?.title ?? isbn,
      authors: meta?.authors ?? [],
      isbn13: isbn,
    });
    return res.ok ? res.duplicates : [];
  } catch {
    return [];
  }
}

/**
 * The tray: items, localStorage per library, and background lookups (ISBN metadata, then the duplicate check)
 * with limited concurrency.
 */
export function useTray(libraryId: string, onResolved?: (item: TrayItem, meta: BookMetadata | null) => void) {
  // This component only renders on the client (see scan-loader), so the stored tray can seed the state directly.
  const [items, dispatch] = useReducer(trayReducer, libraryId, (id) => loadTray(storage(), id));
  const [storageOk] = useState(storageWorks);

  const itemsRef = useRef(items);
  const resolvedRef = useRef(onResolved);
  useEffect(() => {
    itemsRef.current = items;
    resolvedRef.current = onResolved;
  });

  const limiter = useRef(createLimiter(LOOKUP_CONCURRENCY));
  const inflight = useRef(new Map<string, AbortController>());

  // Persist after every change.
  useEffect(() => {
    saveTray(storage(), libraryId, items);
  }, [items, libraryId]);

  // Look up whatever still needs it.
  useEffect(() => {
    for (const item of items) {
      const work = pendingWork(item);
      if (!work || inflight.current.has(item.id)) continue;
      const ctl = new AbortController();
      inflight.current.set(item.id, ctl);
      void limiter.current(async () => {
        if (ctl.signal.aborted) return;
        try {
          let meta = item.meta;
          if (work === "lookup") {
            meta = await fetchByIsbn(item.isbn, ctl.signal);
            if (ctl.signal.aborted) return;
            dispatch(meta ? { type: "found", id: item.id, meta } : { type: "notfound", id: item.id });
          }
          const duplicates = await findDuplicates(libraryId, item.isbn, meta);
          if (ctl.signal.aborted) return;
          dispatch({ type: "duplicates", id: item.id, duplicates });
          resolvedRef.current?.({ ...item, meta, status: meta ? "found" : "notfound", duplicates }, meta);
        } catch {
          if (!ctl.signal.aborted) dispatch({ type: "failed", id: item.id });
        } finally {
          if (inflight.current.get(item.id) === ctl) inflight.current.delete(item.id);
        }
      });
    }
  }, [items, libraryId]);

  // Items removed from the tray stop their lookups; unmount stops them all.
  useEffect(() => {
    const live = new Set(items.map((i) => i.id));
    for (const [id, ctl] of inflight.current) {
      if (!live.has(id)) {
        ctl.abort();
        inflight.current.delete(id);
      }
    }
  }, [items]);
  useEffect(() => {
    const map = inflight.current;
    return () => {
      for (const ctl of map.values()) ctl.abort();
      map.clear();
    };
  }, []);

  /** Adds an ISBN-13. Returns false when it is already in the tray. */
  const add = useCallback((isbn: string): boolean => {
    if (itemsRef.current.some((i) => i.isbn === isbn)) return false;
    dispatch({ type: "add", id: newId(), isbn, now: Date.now() });
    return true;
  }, []);

  return { items, storageFailed: !storageOk, dispatch, add };
}
