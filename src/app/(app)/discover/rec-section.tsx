"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookCheck, BookmarkPlus, Check, EyeOff, RefreshCw } from "lucide-react";
import { Cover } from "@/components/cover";
import { Locked } from "@/components/locked";
import { PickCardsSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import type { PersonalCategory } from "@/lib/ai/recommend-schema";
import { PERSONAL_CATEGORIES } from "@/lib/ai/recommend-schema";
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
  /** Personal picks: the group they are shown under. */
  category?: PersonalCategory;
};

export type RecState =
  /** `ratingsLock`: set while the "Because you rated" group is still locked (personal only). */
  | { kind: "ready"; ratingsLock: { rated: number; needed: number } | null }
  /** The server has no Anthropic key. */
  | { kind: "unavailable" }
  /** Personal: the library is too small to base picks on. */
  | { kind: "needs-books"; have: number; needed: number }
  | { kind: "needs-members" }
  | { kind: "needs-both"; needed: number };

export type CapView = { used: number; cap: number; remaining: number; reached: boolean; message: string | null };

const GROUPS: Record<PersonalCategory, { title: string; lede: string }> = {
  shelves: { title: "From your shelves", lede: "Books that fit the genres, authors and series you collect." },
  ratings: { title: "Because you rated…", lede: "Chosen from your ratings, reading status and notes." },
  authors: { title: "More from your authors", lede: "Books you do not own yet by authors already on your shelves." },
};

function Skeleton() {
  return (
    <div aria-hidden>
      <PickCardsSkeleton />
    </div>
  );
}

function Group({ category, children }: { category: PersonalCategory; children: React.ReactNode }) {
  const { title, lede } = GROUPS[category];
  return (
    <section aria-labelledby={`group-${category}`} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5 border-b border-border pb-2">
        <h3 id={`group-${category}`} className="text-lg leading-snug font-medium">
          {title}
        </h3>
        <p className="text-sm text-muted-foreground">{lede}</p>
      </div>
      {children}
    </section>
  );
}
function RecCard({ pick, libraryId, canEdit, shared, grouped, onGone }: { pick: ClientPick; libraryId: string; canEdit: boolean; shared: boolean; grouped: boolean; onGone: (key: string) => void }) {
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
          <Cover url={pick.coverUrl} title={pick.title} author={pick.authors[0]} sizes="80px" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {(() => {
            const Heading = grouped ? "h4" : "h3";
            return <Heading className="font-display text-lg leading-snug font-medium text-pretty">{pick.title}</Heading>;
          })()}
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
  readOnly = false,
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
  /** No full access: an existing set is shown, but nothing can be refreshed. */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const shared = scope === "shared";
  const visible = picks.filter((p) => !gone.has(p.key));
  const canRefresh = !readOnly && state.kind === "ready" && !cap.reached;

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
        {!readOnly && state.kind !== "unavailable" && state.kind !== "needs-members" && (
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

      {readOnly && <Locked variant="inline" />}
      {!readOnly && cap.reached && cap.message && <p className="text-sm text-muted-foreground">{cap.message}</p>}
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

      {!readOnly && state.kind === "unavailable" && (
        <p className="text-base text-muted-foreground">
          Recommendations are not available on this server right now. Series gaps above still work, and picks return once the Claude API is connected.
        </p>
      )}
      {!readOnly && state.kind === "needs-books" && (
        <div className="flex flex-col gap-3">
          <p className="text-base text-muted-foreground">
            Picks start from the books on your shelves. Your library has {state.have} so far, and {state.needed} gives Claude enough to go on.
          </p>
          <Button asChild variant="outline" className="self-start">
            <Link href="/add">Add a book</Link>
          </Button>
        </div>
      )}
      {!readOnly && state.kind === "needs-members" && (
        <p className="text-base text-muted-foreground">
          This section suggests books you would both like, so it needs a second reader in the library. Invite someone from Settings.
        </p>
      )}
      {!readOnly && state.kind === "needs-both" && (
        <p className="text-base text-muted-foreground">
          Each of you needs at least {state.needed} rated books before there is enough to match your tastes. Rate a few more and come back.
        </p>
      )}

      {pending ? (
        <Skeleton />
      ) : scope === "personal" ? (
        <div className="flex flex-col gap-8">
          {PERSONAL_CATEGORIES.map((category) => {
            const inGroup = visible.filter((p) => (p.category ?? "ratings") === category);
            const lock = category === "ratings" && state.kind === "ready" ? state.ratingsLock : null;
            if (inGroup.length === 0 && !lock) return null;
            return (
              <Group key={category} category={category}>
                {lock && (
                  <p className="text-sm text-muted-foreground">
                    Rate {lock.needed - lock.rated} more {lock.needed - lock.rated === 1 ? "book" : "books"} to unlock picks based on your ratings. You have rated {lock.rated} so far.{" "}
                    <Link href="/library" className="font-medium text-foreground underline decoration-gilt decoration-2 underline-offset-4">
                      Open the library
                    </Link>
                  </p>
                )}
                {inGroup.length > 0 && (
                  <ul className="grid gap-4 md:grid-cols-2">
                    {inGroup.map((p) => (
                      <RecCard key={p.key} pick={p} libraryId={libraryId} canEdit={canEdit} shared={false} grouped onGone={(k) => setGone((g) => new Set(g).add(k))} />
                    ))}
                  </ul>
                )}
              </Group>
            );
          })}
        </div>
      ) : (
        visible.length > 0 && (
          <ul className="grid gap-4 md:grid-cols-2">
            {visible.map((p) => (
              <RecCard key={p.key} pick={p} libraryId={libraryId} canEdit={canEdit} shared={shared} grouped={false} onGone={(k) => setGone((g) => new Set(g).add(k))} />
            ))}
          </ul>
        )
      )}
    </div>
  );
}
