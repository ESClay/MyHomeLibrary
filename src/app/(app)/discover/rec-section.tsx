"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookCheck, BookmarkPlus, Check, EyeOff, RefreshCw } from "lucide-react";
import { Cover } from "@/components/cover";
import { Button } from "@/components/ui/button";
import { markNotInterested, logAlreadyRead, refreshRecommendations, wishlistPick } from "./actions";
import { ReadSheet } from "./read-sheet";

export type ClientPick = {
  key: string;
  title: string;
  authors: string[];
  reason: string;
  fit: { person: string; why: string }[];
  series: string | null;
  coverUrl: string | null;
  year: string | null;
};

export type RecState =
  | { kind: "ready" }
  /** The server has no Anthropic key. */
  | { kind: "unavailable" }
  | { kind: "needs-ratings"; rated: number; needed: number }
  | { kind: "needs-members" }
  | { kind: "needs-both"; needed: number };

export type CapView = { used: number; cap: number; remaining: number; reached: boolean; message: string | null };

function Skeleton() {
  return (
    <div aria-hidden className="grid gap-4 md:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-4 rounded-[10px] border border-dashed border-input p-4">
          <div className="book-cover w-20 shrink-0 animate-pulse border-0 shadow-none" />
          <div className="flex flex-1 flex-col gap-2 pt-1">
            <span className="h-3 w-3/5 animate-pulse rounded-full bg-muted" />
            <span className="h-2.5 w-2/5 animate-pulse rounded-full bg-muted" />
            <span className="mt-2 h-2.5 w-full animate-pulse rounded-full bg-muted" />
            <span className="h-2.5 w-4/5 animate-pulse rounded-full bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function RecCard({ pick, libraryId, canEdit, shared, onGone }: { pick: ClientPick; libraryId: string; canEdit: boolean; shared: boolean; onGone: (key: string) => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [wished, setWished] = useState<{ id?: string; message?: string } | null>(null);
  const [reading, setReading] = useState(false);

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, then?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) then?.();
      else setError(res.error);
    });
  }

  function alreadyRead() {
    // Feedback is saved at once; the sheet then offers to log the read and rating.
    run(
      () => logAlreadyRead({ libraryId, key: pick.key, placement: "skip", rating: null, finishedAt: null }),
      () => setReading(true),
    );
  }

  return (
    <li className="panel flex flex-col gap-4 p-4">
      <div className="flex gap-4">
        <div className="w-20 shrink-0">
          <Cover url={pick.coverUrl} title={pick.title} author={pick.authors[0]} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h3 className="font-display text-lg leading-snug font-medium text-pretty">{pick.title}</h3>
          <p className="text-sm text-muted-foreground">
            {[pick.authors.slice(0, 2).join(" & "), pick.year].filter(Boolean).join(" · ")}
            {pick.series ? ` · ${pick.series}` : ""}
          </p>
          {shared && pick.fit.length > 0 ? (
            <ul className="mt-1 flex flex-col gap-1.5 text-[0.9375rem] leading-snug text-pretty">
              {pick.fit.map((f) => (
                <li key={f.person}>
                  <span className="font-semibold">{f.person}:</span> {f.why}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[0.9375rem] leading-snug text-pretty">{pick.reason}</p>
          )}
        </div>
      </div>

      {wished ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Check className="size-4 text-primary" aria-hidden />
          {wished.message ?? "Added to your wishlist."}
          {wished.id && (
            <Link href={`/books/${wished.id}`} className="font-medium text-foreground underline decoration-gilt decoration-2 underline-offset-4">
              Open
            </Link>
          )}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {canEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  async () => {
                    const res = await wishlistPick({ libraryId, key: pick.key });
                    if (res.ok) setWished({ id: res.id, message: res.message });
                    return res;
                  },
                  () => router.refresh(),
                )
              }
            >
              <BookmarkPlus aria-hidden />
              Add to wishlist
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={alreadyRead}>
            <BookCheck aria-hidden />
            Already read
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => run(() => markNotInterested({ libraryId, key: pick.key }), () => onGone(pick.key))}>
            <EyeOff aria-hidden />
            Not interested
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {reading && (
        <ReadSheet
          libraryId={libraryId}
          pick={pick}
          canEdit={canEdit}
          onClose={() => {
            setReading(false);
            onGone(pick.key);
          }}
          onDone={() => {
            setReading(false);
            onGone(pick.key);
            router.refresh();
          }}
        />
      )}
    </li>
  );
}

export function RecSection({
  libraryId,
  scope,
  state,
  picks,
  updatedLabel,
  updatedAt,
  cap,
  canEdit,
  lastError,
}: {
  libraryId: string;
  scope: "personal" | "shared";
  state: RecState;
  picks: ClientPick[];
  updatedLabel: string | null;
  updatedAt: string | null;
  cap: CapView;
  canEdit: boolean;
  lastError?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const shared = scope === "shared";
  const visible = picks.filter((p) => !gone.has(p.key));
  const canRefresh = state.kind === "ready" && !cap.reached;

  function refresh() {
    setError(null);
    startTransition(async () => {
      const res = await refreshRecommendations({ libraryId, scope });
      if (res.ok) {
        setGone(new Set());
        router.refresh();
      } else setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {pending ? (
            "Choosing books. This can take a minute or two."
          ) : updatedLabel && updatedAt ? (
            <>
              Last updated <time dateTime={updatedAt}>{updatedLabel}</time>
            </>
          ) : state.kind === "ready" ? (
            "Nothing chosen yet."
          ) : null}
        </p>
        {state.kind !== "unavailable" && state.kind !== "needs-members" && (
          <div className="flex flex-col gap-1 sm:items-end">
            <Button type="button" variant={visible.length === 0 ? "default" : "outline"} onClick={refresh} disabled={!canRefresh || pending} aria-busy={pending}>
              <RefreshCw className={pending ? "animate-spin" : ""} aria-hidden />
              {pending ? "Choosing…" : visible.length === 0 && !updatedAt ? "Find books" : "Refresh"}
            </Button>
            {state.kind === "ready" && (
              <p className="text-xs text-muted-foreground">
                {cap.reached ? "No refreshes left today" : `${cap.remaining} of ${cap.cap} refreshes left today`}
              </p>
            )}
          </div>
        )}
      </div>

      {cap.reached && cap.message && <p className="text-sm text-muted-foreground">{cap.message}</p>}
      {error && (
        <p role="alert" className="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {!error && lastError && state.kind === "ready" && visible.length === 0 && (
        <p role="alert" className="text-sm text-muted-foreground">
          {lastError}
        </p>
      )}

      {state.kind === "unavailable" && (
        <p className="text-base text-muted-foreground">
          Recommendations are not available on this server right now. Series gaps above still work, and picks return once the Claude API is connected.
        </p>
      )}
      {state.kind === "needs-ratings" && (
        <div className="flex flex-col gap-3">
          <p className="text-base text-muted-foreground">
            Picks come from what you have rated. You have rated {state.rated} so far, and {state.needed} gives Claude enough to go on. Rating more books, and leaving a note on the ones you loved or dropped, makes the picks better.
          </p>
          <Button asChild variant="outline" className="self-start">
            <Link href="/library">Open the library</Link>
          </Button>
        </div>
      )}
      {state.kind === "needs-members" && (
        <p className="text-base text-muted-foreground">
          This section suggests books you would both like, so it needs a second reader in the library. Invite someone from Settings.
        </p>
      )}
      {state.kind === "needs-both" && (
        <p className="text-base text-muted-foreground">
          Each of you needs at least {state.needed} rated books before there is enough to match your tastes. Rate a few more and come back.
        </p>
      )}

      {pending ? (
        <Skeleton />
      ) : (
        visible.length > 0 && (
          <ul className="grid gap-4 md:grid-cols-2">
            {visible.map((p) => (
              <RecCard key={p.key} pick={p} libraryId={libraryId} canEdit={canEdit} shared={shared} onGone={(k) => setGone((s) => new Set(s).add(k))} />
            ))}
          </ul>
        )
      )}
    </div>
  );
}
