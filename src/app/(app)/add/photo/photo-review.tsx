"use client";

import { useMemo, useReducer, useState, type Dispatch } from "react";
import Link from "next/link";
import { BookCheck, Check, ChevronDown, CircleAlert, ImageIcon, LoaderCircle, RotateCw, Search } from "lucide-react";
import { addCopy, checkDuplicates, createBook } from "@/app/(app)/books/actions";
import { addBooksToShelves } from "@/app/(app)/shelves/actions";
import { ShelfPicker } from "@/components/shelf-picker";
import { Segmented } from "@/app/(app)/add/scan/review-sheet";
import { copyDraftToInput, draftFromMetadata, draftToFields, emptyBookDraft, emptyCopyDraft, Field } from "@/components/book-forms";
import { Cover } from "@/components/cover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  CONDITIONS,
  CONDITION_LABEL,
  FORMATS,
  FORMAT_LABEL,
  OWNERSHIPS,
  OWNERSHIP_LABEL,
  type Condition,
  type Format,
  type Ownership,
} from "@/lib/books/constants";
import type { BookMetadata } from "@/lib/metadata/types";
import { CONFIDENCE_LABEL, confidenceBand, type ConfidenceBand } from "@/lib/scan/photo";
import { allowedActions, DEFAULT_BULK, resolveItem, summarize, type BulkSettings, type Resolved } from "@/lib/scan/plan";
import type { ScanItem } from "@/lib/scan/resolve";
import { trayReducer, type ItemOverrides, type TrayAction, type TrayItem } from "@/lib/scan/tray";
import { cn } from "@/lib/utils";
import { setCoverFromScan } from "./actions";

const FOLLOW = "__bulk";
const NOT_SET = "__none";

/** Rows the model was unsure about start unchecked, so a wrong guess is never saved by accident. */
const START_THRESHOLD = 0.5;

/** The review rows reuse the barcode tray's reducer and settings plan: a photo row is a tray row with no required ISBN. */
function toTrayItem(s: ScanItem, i: number): TrayItem {
  const matched = !!s.best;
  const overrides: ItemOverrides = matched ? {} : { title: s.detected.title, authors: s.detected.authors.join(", ") };
  if (s.detected.confidence < START_THRESHOLD) overrides.action = "skip";
  return {
    id: s.id,
    isbn: s.best?.isbn13 ?? "",
    addedAt: i,
    status: matched ? "found" : "notfound",
    meta: s.best,
    duplicates: s.duplicates,
    overrides,
  };
}

const candidateKey = (m: BookMetadata) => m.isbn13 ?? `${m.title}|${m.authors[0] ?? ""}`;

function Meter({ band }: { band: ConfidenceBand }) {
  const filled = band === "clear" ? 3 : band === "probable" ? 2 : 1;
  return (
    <span aria-hidden className="flex items-end gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn("w-1 rounded-[1px]", i === 0 ? "h-1.5" : i === 1 ? "h-2.5" : "h-3.5", i < filled ? (band === "unsure" ? "bg-destructive" : "bg-gilt") : "bg-border")}
        />
      ))}
    </span>
  );
}

function Check1({ checked, disabled, onChange, label }: { checked: boolean; disabled: boolean; onChange: () => void; label: string }) {
  return (
    <label className={cn("relative flex size-11 shrink-0 items-center justify-center", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} aria-label={label} className="peer sr-only" />
      <span className="flex size-6 items-center justify-center rounded-md border border-input bg-card text-primary-foreground transition-[background-color,border-color,transform] duration-[var(--dur-fast)] peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background peer-active:scale-95 [&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100">
        <Check aria-hidden className="size-4" strokeWidth={3} />
      </span>
    </label>
  );
}

type SaveResult = { error: string | null; warning?: string };

async function saveOne(
  libraryId: string,
  item: TrayItem,
  extra: ScanItem,
  r: Resolved,
  photoJobId: string | null,
  shelfIds: string[],
): Promise<SaveResult> {
  const meta = item.meta;
  const copy = { ...emptyCopyDraft, format: r.format, condition: r.condition, editionIsbn: meta?.isbn13 ?? "" };

  if (r.action === "copy") {
    if (!r.targetBookId) return { error: "The matching book could not be found." };
    const res = await addCopy({ bookId: r.targetBookId, copy: copyDraftToInput(copy) });
    if (res.ok && shelfIds.length) await addBooksToShelves({ shelfIds, bookIds: [r.targetBookId] }).catch(() => null);
    return { error: res.ok ? null : res.error };
  }

  const draft = meta
    ? draftFromMetadata(meta)
    : {
        ...emptyBookDraft,
        title: (item.overrides.title ?? "").trim(),
        authors: (item.overrides.authors ?? "").trim(),
        seriesName: extra.detected.series ?? "",
        seriesPosition: extra.detected.seriesPosition === null ? "" : String(extra.detected.seriesPosition),
        isbn13: extra.detected.isbn ?? "",
      };
  const res = await createBook({
    libraryId,
    book: draftToFields(draft, r.ownership, meta?.covers[0]?.url ?? null),
    provider: {
      hardcoverId: meta?.ids.hardcover ?? null,
      googleBooksId: meta?.ids.google ?? null,
      olKey: meta?.ids.openLibrary ?? null,
      publicRating: meta?.rating?.value ?? null,
      publicRatingCount: meta?.rating?.count ?? null,
      ratingSource: meta?.rating?.source ?? null,
    },
    copy: r.ownership === "owned" ? copyDraftToInput(copy) : null,
    myStatus: r.ownership === "owned" ? null : "want",
    force: false,
    shelfIds,
  });
  if (!res.ok) return { error: res.duplicates?.length ? "Already in your library." : res.error };
  if (photoJobId) {
    const cover = await setCoverFromScan({ jobId: photoJobId, bookId: res.id });
    if (!cover.ok) return { error: null, warning: `Saved, but your photo could not be used as the cover: ${cover.error}` };
  }
  return { error: null };
}

function Row({
  libraryId,
  item,
  extra,
  bulk,
  dispatch,
  disabled,
  error,
  offerPhotoCover,
  usePhoto,
  onUsePhoto,
}: {
  libraryId: string;
  item: TrayItem;
  extra: ScanItem;
  bulk: BulkSettings;
  dispatch: Dispatch<TrayAction>;
  disabled: boolean;
  error: string | undefined;
  offerPhotoCover: boolean;
  usePhoto: boolean;
  onUsePhoto: (v: boolean) => void;
}) {
  const [swapOpen, setSwapOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<BookMetadata[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const r = resolveItem(item, bulk);
  const set = (patch: ItemOverrides) => dispatch({ type: "override", id: item.id, patch });
  const dup = item.duplicates?.[0];
  const band = confidenceBand(extra.detected.confidence);
  const included = r.action !== "skip";
  const wanted = dup ? "copy" : "add";
  const canInclude = allowedActions(item, r.ownership).includes(wanted);
  const title = item.meta?.title ?? (item.overrides.title?.trim() || extra.detected.title);
  const authors = item.meta?.authors.join(", ") || item.overrides.authors || extra.detected.authors.join(", ");
  const pool = useMemo(() => {
    const seen = new Set<string>();
    const out: BookMetadata[] = [];
    for (const m of [...(extra.best ? [extra.best] : []), ...extra.alternates, ...found]) {
      const k = candidateKey(m);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(m);
      }
    }
    return out;
  }, [extra, found]);
  const currentKey = item.meta ? candidateKey(item.meta) : null;
  const rowId = `row-${item.id}`;

  async function choose(meta: BookMetadata) {
    dispatch({ type: "found", id: item.id, meta });
    set({ action: "add" });
    const res = await checkDuplicates({ libraryId, title: meta.title, authors: meta.authors, isbn13: meta.isbn13 }).catch(() => null);
    const duplicates = res && res.ok ? res.duplicates : [];
    dispatch({ type: "duplicates", id: item.id, duplicates });
    set({ action: duplicates.length ? "skip" : "add" });
  }

  function chooseNone() {
    dispatch({ type: "notfound", id: item.id });
    dispatch({ type: "duplicates", id: item.id, duplicates: [] });
    set({ title: item.overrides.title || extra.detected.title, authors: item.overrides.authors ?? extra.detected.authors.join(", "), action: "skip" });
  }

  async function runSearch() {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/suggest?${new URLSearchParams({ source: "online", q })}`);
      if (!res.ok) throw new Error("search failed");
      const { results } = (await res.json()) as { results: BookMetadata[] };
      setFound(results.slice(0, 8));
      if (results.length === 0) setSearchError("No books matched that search.");
    } catch {
      setSearchError("The search is unavailable right now.");
    } finally {
      setSearching(false);
    }
  }

  const read = extra.detected.title;
  const showRead = !!item.meta && band !== "clear" && read.toLowerCase() !== item.meta.title.toLowerCase();

  return (
    <li className="flex flex-col gap-3 px-3 py-3 sm:px-4">
      <div className="flex gap-1">
        <Check1
          checked={included}
          disabled={disabled || (!canInclude && !included)}
          onChange={() => set({ action: included ? "skip" : wanted })}
          label={`${included ? "Skip" : "Include"} ${title}`}
        />
        <Cover url={item.meta?.covers[0]?.url ?? null} title={title} author={authors} className="w-12 shrink-0 self-start" />
        <div className="ml-2 flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-display line-clamp-2 text-base leading-snug font-medium">{title}</p>
          <p className="truncate text-sm text-muted-foreground">{authors || "Unknown author"}</p>
          {item.meta?.seriesName && (
            <p className="truncate text-xs text-muted-foreground">
              {item.meta.seriesName}
              {item.meta.seriesPosition !== null ? ` #${item.meta.seriesPosition}` : ""}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Meter band={band} /> {CONFIDENCE_LABEL[band]}
            </span>
            {dup && (
              <span className="flex items-center gap-1 font-semibold tracking-[0.08em] text-gilt uppercase">
                <BookCheck aria-hidden className="size-3.5" /> In library
              </span>
            )}
            {!item.meta && <span className="text-muted-foreground">No match found</span>}
          </div>
          {showRead && <p className="text-xs text-muted-foreground">Read from the photo as &ldquo;{read}&rdquo;</p>}
          {dup && included && <p className="text-xs text-muted-foreground">Adds another copy to the book you already have.</p>}
          {!included && dup && <p className="text-xs text-muted-foreground">Skipped because you already have it.</p>}
        </div>
      </div>

      {!item.meta && (
        <div className="grid gap-3 pl-12 sm:grid-cols-2">
          <Field label="Title">
            {(id) => <Input id={id} value={item.overrides.title ?? ""} onChange={(e) => set({ title: e.target.value })} maxLength={300} autoComplete="off" disabled={disabled} />}
          </Field>
          <Field label="Authors">
            {(id) => <Input id={id} value={item.overrides.authors ?? ""} onChange={(e) => set({ authors: e.target.value })} autoComplete="off" disabled={disabled} />}
          </Field>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 pl-12">
        <button
          type="button"
          aria-expanded={swapOpen}
          aria-controls={`${rowId}-swap`}
          disabled={disabled}
          onClick={() => setSwapOpen((v) => !v)}
          className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg text-sm font-semibold underline decoration-gilt decoration-2 underline-offset-4 hover:decoration-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          Not this one
          <ChevronDown aria-hidden className={cn("size-4 transition-transform duration-[var(--dur)]", swapOpen && "rotate-180")} />
        </button>
        {included && (
          <button
            type="button"
            aria-expanded={settingsOpen}
            aria-controls={`${rowId}-settings`}
            onClick={() => setSettingsOpen((v) => !v)}
            className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Settings for this book
            <ChevronDown aria-hidden className={cn("size-4 transition-transform duration-[var(--dur)]", settingsOpen && "rotate-180")} />
          </button>
        )}
      </div>

      <div id={`${rowId}-swap`} hidden={!swapOpen} className="ml-12 flex flex-col gap-3 rounded-lg border border-border bg-secondary/50 p-3">
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-semibold">Which book is it?</legend>
          {pool.map((m) => (
            <label key={candidateKey(m)} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-1 hover:bg-card has-[:checked]:bg-card has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
              <input type="radio" name={`pick-${item.id}`} className="size-4 accent-[var(--primary)]" checked={currentKey === candidateKey(m)} onChange={() => void choose(m)} disabled={disabled} />
              <Cover url={m.covers[0]?.url ?? null} title={m.title} className="w-8 shrink-0" />
              <span className="flex min-w-0 flex-col">
                <span className="line-clamp-2 text-sm font-medium">{m.title}</span>
                <span className="truncate text-xs text-muted-foreground">{m.authors.join(", ") || "Unknown author"}</span>
              </span>
            </label>
          ))}
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-1 hover:bg-card has-[:checked]:bg-card has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
            <input type="radio" name={`pick-${item.id}`} className="size-4 accent-[var(--primary)]" checked={!item.meta} onChange={chooseNone} disabled={disabled} />
            <span className="text-sm font-medium">None of these. I will type it.</span>
          </label>
        </fieldset>
        <form
          role="search"
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch();
          }}
        >
          <Input aria-label="Search for this book by hand" placeholder="Title, author or ISBN" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" disabled={disabled} />
          <Button type="submit" variant="outline" disabled={disabled || searching || query.trim().length < 2}>
            {searching ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Search aria-hidden />} Search
          </Button>
        </form>
        {searchError && (
          <p role="status" className="text-sm text-muted-foreground">
            {searchError}
          </p>
        )}
      </div>

      {included && (
        <div id={`${rowId}-settings`} hidden={!settingsOpen} className="grid gap-3 pl-12 sm:grid-cols-3">
          {r.action === "add" && (
            <Field label="Where does it go?">
              {(id) => (
                <NativeSelect id={id} value={item.overrides.ownership ?? FOLLOW} disabled={disabled} onChange={(e) => set({ ownership: e.target.value === FOLLOW ? undefined : (e.target.value as Ownership) })}>
                  <option value={FOLLOW}>Same as all ({OWNERSHIP_LABEL[bulk.ownership]})</option>
                  {OWNERSHIPS.map((o) => (
                    <option key={o} value={o}>
                      {OWNERSHIP_LABEL[o]}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          )}
          {r.ownership === "owned" && (
            <>
              <Field label="Format">
                {(id) => (
                  <NativeSelect id={id} value={item.overrides.format ?? FOLLOW} disabled={disabled} onChange={(e) => set({ format: e.target.value === FOLLOW ? undefined : (e.target.value as Format) })}>
                    <option value={FOLLOW}>Same as all ({FORMAT_LABEL[bulk.format]})</option>
                    {FORMATS.map((f) => (
                      <option key={f} value={f}>
                        {FORMAT_LABEL[f]}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label="Condition">
                {(id) => (
                  <NativeSelect
                    id={id}
                    value={item.overrides.condition === undefined ? FOLLOW : item.overrides.condition === "" ? NOT_SET : item.overrides.condition}
                    disabled={disabled}
                    onChange={(e) => set({ condition: e.target.value === FOLLOW ? undefined : e.target.value === NOT_SET ? "" : (e.target.value as Condition) })}
                  >
                    <option value={FOLLOW}>Same as all ({bulk.condition === "" ? "not set" : CONDITION_LABEL[bulk.condition]})</option>
                    <option value={NOT_SET}>Not set</option>
                    {CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {CONDITION_LABEL[c]}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
            </>
          )}
        </div>
      )}

      {offerPhotoCover && r.action === "add" && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 pl-12 text-sm font-medium">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={usePhoto} onChange={(e) => onUsePhoto(e.target.checked)} disabled={disabled} />
          Use my photo as the cover
        </label>
      )}

      {error && (
        <p role="alert" className="flex items-start gap-1.5 pl-12 text-sm text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}
    </li>
  );
}

export function PhotoReview({
  libraryId,
  jobId,
  photoUrl,
  items,
  dropped,
  onSaved,
  onStartOver,
}: {
  libraryId: string;
  jobId: string | null;
  photoUrl: string | null;
  items: ScanItem[];
  dropped: number;
  /** Called once everything is saved, so the photo can be deleted. */
  onSaved: () => Promise<void>;
  onStartOver: () => Promise<void>;
}) {
  const [tray, dispatch] = useReducer(trayReducer, items, (list) => list.map(toTrayItem));
  const [bulk, setBulk] = useState<BulkSettings>(DEFAULT_BULK);
  const [usePhoto, setUsePhoto] = useState(false);
  const [shelfIds, setShelfIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<{ saved: number; failed: number } | null>(null);

  const extras = useMemo(() => new Map(items.map((s) => [s.id, s])), [items]);
  const offerPhotoCover = items.length === 1 && items[0].detected.kind === "cover" && !!jobId;
  const { resolved, toAdd, toCopy, skipped } = summarize(tray, bulk);
  const todo = toAdd + toCopy;
  const allDone = outcome !== null && outcome.failed === 0;

  async function saveAll() {
    const plan = resolved.filter((r) => r.action !== "skip");
    if (plan.length === 0) return;
    setSaving(true);
    setErrors({});
    setWarnings([]);
    setOutcome(null);
    setProgress({ done: 0, total: plan.length });
    const nextErrors: Record<string, string> = {};
    const nextWarnings: string[] = [];
    let saved = 0;
    for (const r of plan) {
      const item = tray.find((i) => i.id === r.id);
      const extra = extras.get(r.id);
      if (!item || !extra) continue;
      let result: SaveResult;
      try {
        result = await saveOne(libraryId, item, extra, r, offerPhotoCover && usePhoto ? jobId : null, shelfIds);
      } catch {
        result = { error: "Could not save this one. Try again." };
      }
      if (result.error) nextErrors[r.id] = result.error;
      else {
        saved++;
        if (result.warning) nextWarnings.push(result.warning);
        dispatch({ type: "remove", ids: [r.id] });
      }
      setProgress({ done: saved + Object.keys(nextErrors).length, total: plan.length });
    }
    setErrors(nextErrors);
    setWarnings(nextWarnings);
    setOutcome({ saved, failed: Object.keys(nextErrors).length });
    setSaving(false);
    if (Object.keys(nextErrors).length === 0) await onSaved();
  }

  if (allDone) {
    return (
      <section className="panel rise flex flex-col gap-4 p-5" aria-labelledby="saved-h">
        <h2 id="saved-h" role="status" className="font-display text-xl leading-snug font-medium">
          {outcome.saved} {outcome.saved === 1 ? "book" : "books"} added.
        </h2>
        {warnings.map((w) => (
          <p key={w} className="text-sm text-muted-foreground">
            {w}
          </p>
        ))}
        <p className="text-sm text-muted-foreground">Your photo has been deleted.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild>
            <Link href="/library">View the library</Link>
          </Button>
          <Button type="button" variant="outline" onClick={() => void onStartOver()}>
            Photograph more
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rise flex items-center gap-3">
        {photoUrl ? (
          // The photo the person just took, from a local object URL.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="Your photo" className="h-16 w-20 shrink-0 rounded-lg object-cover shadow-[var(--shadow-cover)]" />
        ) : (
          <span className="flex h-16 w-20 shrink-0 items-center justify-center rounded-lg bg-secondary">
            <ImageIcon aria-hidden className="size-5 text-muted-foreground" />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="font-display text-xl leading-snug font-medium">
            {items.length === 0 ? "No books found" : `Found ${items.length} ${items.length === 1 ? "book" : "books"}`}
          </h2>
          <p className="text-sm text-muted-foreground">
            {items.length === 0
              ? "Try a closer, brighter photo with the titles facing the camera."
              : "Listed in shelf order, left to right. Nothing is saved until you press the button below."}
            {dropped > 0 && ` ${dropped} could not be read.`}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void onStartOver()}>
          <RotateCw aria-hidden /> Start over
        </Button>
      </div>

      {items.length > 0 && (
        <>
          <section aria-labelledby="bulk-h" className="panel flex flex-col gap-4 p-4">
            <h3 id="bulk-h" className="font-display text-lg font-medium">
              For all books
            </h3>
            <Segmented label="Where do they go?" value={bulk.ownership} onChange={(ownership) => setBulk({ ...bulk, ownership })} />
            {bulk.ownership === "owned" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Format">
                  {(id) => (
                    <NativeSelect id={id} value={bulk.format} onChange={(e) => setBulk({ ...bulk, format: e.target.value as Format })}>
                      {FORMATS.map((f) => (
                        <option key={f} value={f}>
                          {FORMAT_LABEL[f]}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
                <Field label="Condition">
                  {(id) => (
                    <NativeSelect id={id} value={bulk.condition} onChange={(e) => setBulk({ ...bulk, condition: e.target.value as Condition | "" })}>
                      <option value="">Not set</option>
                      {CONDITIONS.map((c) => (
                        <option key={c} value={c}>
                          {CONDITION_LABEL[c]}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
              </div>
            )}
            <ShelfPicker libraryId={libraryId} value={shelfIds} onChange={setShelfIds} disabled={saving} />
            <p className="text-sm text-muted-foreground">
              Each book can use its own settings. Books already in your library are skipped unless you tick them to add another copy.
            </p>
          </section>

          <ul className="panel flex flex-col divide-y divide-border">
            {tray.map((i) => (
              <Row
                key={i.id}
                libraryId={libraryId}
                item={i}
                extra={extras.get(i.id)!}
                bulk={bulk}
                dispatch={dispatch}
                disabled={saving}
                error={errors[i.id]}
                offerPhotoCover={offerPhotoCover}
                usePhoto={usePhoto}
                onUsePhoto={setUsePhoto}
              />
            ))}
          </ul>

          <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 flex flex-col gap-2 rounded-[14px] border border-border bg-card p-3 shadow-[var(--shadow-card)] md:bottom-4">
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {saving
                ? `Saving ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                : outcome
                  ? `Saved ${outcome.saved}. ${outcome.failed} could not be saved and ${outcome.failed === 1 ? "is" : "are"} still listed.`
                  : `${toAdd} to add${toCopy ? `, ${toCopy} extra ${toCopy === 1 ? "copy" : "copies"}` : ""}, ${skipped} skipped.`}
            </p>
            {saving && (
              <div role="progressbar" aria-label="Saving books" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width] duration-[var(--dur)]" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
            )}
            <Button type="button" size="lg" className="w-full" disabled={saving || todo === 0} onClick={() => void saveAll()}>
              {saving ? "Saving…" : todo === 0 ? "Nothing to save" : `Save ${todo} ${todo === 1 ? "book" : "books"}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
