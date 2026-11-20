"use client";

import { useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { DISCOVER_TABS, panelId, tabId, type DiscoverTabId } from "./tab-ids";

/**
 * Tab list per the WAI-ARIA tabs pattern, with manual activation: arrow keys move focus, Enter (the link) opens the tab.
 * Each tab is a link to ?tab=, so the active tab survives a reload and the Back button.
 */
export function DiscoverTabs({ active, counts }: { active: DiscoverTabId; counts?: Partial<Record<DiscoverTabId, number>> }) {
  const refs = useRef<Record<string, HTMLAnchorElement | null>>({});

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const last = DISCOVER_TABS.length - 1;
    const next = e.key === "ArrowRight" ? (index === last ? 0 : index + 1) : e.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) return;
    e.preventDefault();
    refs.current[DISCOVER_TABS[next].id]?.focus();
  }

  return (
    <div role="tablist" aria-label="Discover sections" className="rise -mx-1 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border px-1" style={{ ["--i" as string]: 1 }}>
      {DISCOVER_TABS.map((t, i) => {
        const selected = t.id === active;
        const count = counts?.[t.id];
        return (
          <Link
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            id={tabId(t.id)}
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(t.id)}
            tabIndex={selected ? 0 : -1}
            href={t.id === "series" ? "/discover" : `/discover?tab=${t.id}`}
            scroll={false}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "relative -mb-px inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-t-md border-b-2 px-3 text-[0.9375rem] font-medium whitespace-nowrap transition-[color,border-color,background-color] duration-[var(--dur-fast)] ease-[var(--ease)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-accent/70",
              selected ? "border-gilt text-foreground" : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {t.label}
            {count !== undefined && count > 0 && (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground tabular-nums">{count}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
