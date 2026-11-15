"use client";

import { useState, type Dispatch } from "react";
import Link from "next/link";
import { BookCheck, ChevronDown, CircleAlert } from "lucide-react";
import { addCopy, createBook } from "@/app/(app)/books/actions";
import { copyDraftToInput, draftFromMetadata, draftToFields, emptyBookDraft, emptyCopyDraft, Field } from "@/components/book-forms";
import { Cover } from "@/components/cover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
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
import { allowedActions, DEFAULT_BULK, resolveItem, summarize, type BulkSettings, type Resolved } from "@/lib/scan/plan";
import type { ItemAction, ItemOverrides, TrayAction, TrayItem } from "@/lib/scan/tray";
import { cn } from "@/lib/utils";
import { itemTitle } from "./tray";

const FOLLOW = "__bulk";
const NOT_SET = "__none";

const ACTION_LABEL: Record<ItemAction, string> = {
  add: "Add to library",
  copy: "Add another copy to the book I have",
  skip: "Skip",
};

async function saveOne(libraryId: string, item: TrayItem, r: Resolved): Promise<string | null> {
  const copy = { ...emptyCopyDraft, format: r.format, condition: r.condition, editionIsbn: item.isbn };

  if (r.action === "copy") {
    if (!r.targetBookId) return "The matching book could not be found.";
    const res = await addCopy({ bookId: r.targetBookId, copy: copyDraftToInput(copy) });
    return res.ok ? null : res.error;
  }

  const meta = item.meta;
  const draft = meta
    ? { ...draftFromMetadata(meta), isbn13: meta.isbn13 ?? item.isbn }
    : {
        ...emptyBookDraft,
        title: (item.overrides.title ?? "").trim(),
        authors: (item.overrides.authors ?? "").trim(),
        isbn13: item.isbn,
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
  });
  if (res.ok) return null;
  return res.duplicates?.length ? "Already in your library." : res.error;
}

export function Segmented({ value, onChange, label }: { value: Ownership; onChange: (o: Ownership) => void; label: string }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold">{label}</legend>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={label}>
        {OWNERSHIPS.map((o) => (
          <label key={o} className="cursor-pointer">
            <input type="radio" name="bulk-ownership" value={o} checked={value === o} onChange={() => onChange(o)} className="peer sr-only" />
            <span className="flex h-11 items-center justify-center rounded-lg border border-input bg-card text-[0.9375rem] font-medium transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring hover:border-foreground/40">
              {o === "owned" ? "On my shelf" : "On my wishlist"}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ItemCard({
  item,
  bulk,
  dispatch,
  error,
  disabled,
}: {
  item: TrayItem;
  bulk: BulkSettings;
  dispatch: Dispatch<TrayAction>;
  error: string | undefined;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const r = resolveItem(item, bulk);
  const set = (patch: ItemOverrides) => dispatch({ type: "override", id: item.id, patch });
  const title = itemTitle(item);
  const dup = item.duplicates?.[0];
  const options = allowedActions(item, r.ownership);
  const detailsId = `d-${item.id}`;

  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex gap-3">
        <Cover url={item.meta?.covers[0]?.url ?? null} title={title} className="w-12 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="font-display line-clamp-2 text-base leading-snug font-medium">{title}</p>
          <p className="truncate text-sm text-muted-foreground">
            {item.meta?.authors.join(", ") || `ISBN ${item.isbn}`}
          </p>
          {dup && (
            <p className="flex items-center gap-1 text-xs font-semibold tracking-[0.08em] text-gilt uppercase">
              <BookCheck aria-hidden className="size-3.5" /> In library
            </p>
          )}
          {item.status === "notfound" && !dup && <p className="text-xs text-muted-foreground">Not found. Add a title to include it.</p>}
          {r.action === "skip" && r.reason && item.status !== "notfound" && <p className="text-xs text-muted-foreground">{r.reason}</p>}
        </div>
      </div>

      {item.status === "notfound" && !dup && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title">
            {(id) => <Input id={id} value={item.overrides.title ?? ""} onChange={(e) => set({ title: e.target.value })} maxLength={300} autoComplete="off" disabled={disabled} />}
          </Field>
          <Field label="Authors">
            {(id) => <Input id={id} value={item.overrides.authors ?? ""} onChange={(e) => set({ authors: e.target.value })} autoComplete="off" disabled={disabled} />}
          </Field>
        </div>
      )}

      <Field label="What to do">
        {(id) => (
          <NativeSelect id={id} value={r.action} disabled={disabled || options.length < 2} onChange={(e) => set({ action: e.target.value as ItemAction })}>
            {options.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>

      {r.action !== "skip" && (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((v) => !v)}
            className="-my-1 flex min-h-11 w-full cursor-pointer items-center justify-between rounded-lg text-left text-sm font-semibold"
          >
            Settings for this book
            <ChevronDown aria-hidden className={cn("size-4 transition-transform duration-[var(--dur)]", open && "rotate-180")} />
          </button>
          <div id={detailsId} hidden={!open} className="grid gap-3 sm:grid-cols-3">
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
        </>
      )}

      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}
    </li>
  );
}

export function ReviewSheet({
  libraryId,
  items,
  dispatch,
  onClose,
}: {
  libraryId: string;
  items: TrayItem[];
  dispatch: Dispatch<TrayAction>;
  onClose: () => void;
}) {
  const [bulk, setBulk] = useState<BulkSettings>(DEFAULT_BULK);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<{ saved: number; failed: number } | null>(null);

  const { resolved, toAdd, toCopy, skipped } = summarize(items, bulk);
  const todo = toAdd + toCopy;
  const lookingUp = items.some((i) => i.status === "pending");

  async function saveAll() {
    const plan = resolved.filter((r) => r.action !== "skip");
    if (plan.length === 0) return;
    setSaving(true);
    setErrors({});
    setOutcome(null);
    setProgress({ done: 0, total: plan.length });
    const nextErrors: Record<string, string> = {};
    let saved = 0;
    for (const r of plan) {
      const item = items.find((i) => i.id === r.id);
      if (!item) continue;
      let error: string | null;
      try {
        error = await saveOne(libraryId, item, r);
      } catch {
        error = "Could not save this one. Try again.";
      }
      if (error) nextErrors[r.id] = error;
      else {
        saved++;
        dispatch({ type: "remove", ids: [r.id] }); // saved books leave the tray at once, failed ones stay.
      }
      setProgress({ done: saved + Object.keys(nextErrors).length, total: plan.length });
    }
    setErrors(nextErrors);
    setOutcome({ saved, failed: Object.keys(nextErrors).length });
    setSaving(false);
  }

  const allDone = outcome !== null && outcome.failed === 0;

  return (
    <Sheet open onOpenChange={(open) => !open && !saving && onClose()}>
      <SheetContent
        title={allDone ? "All saved" : `Review ${items.length} ${items.length === 1 ? "book" : "books"}`}
        description={allDone ? undefined : "Nothing is saved until you press the button below."}
      >
        {allDone ? (
          <div className="flex flex-col gap-4 px-5 py-6">
            <p role="status" className="font-display text-xl leading-snug font-medium">
              {outcome.saved} {outcome.saved === 1 ? "book" : "books"} added.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild>
                <Link href="/library">View the library</Link>
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>
                Keep scanning
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <section aria-labelledby="bulk-h" className="flex flex-col gap-4 border-b border-border px-5 py-4">
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
                <p className="text-sm text-muted-foreground">
                  Each book below can use its own settings. Books already in your library are skipped unless you choose to add another copy.
                </p>
              </section>

              {items.length === 0 ? (
                <p className="px-5 py-6 text-base text-muted-foreground">The tray is empty.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {items.map((i) => (
                    <ItemCard key={i.id} item={i} bulk={bulk} dispatch={dispatch} error={errors[i.id]} disabled={saving} />
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t border-border bg-card px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                {saving
                  ? `Saving ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                  : outcome
                    ? `Saved ${outcome.saved}. ${outcome.failed} could not be saved and ${outcome.failed === 1 ? "is" : "are"} still in the tray.`
                    : `${toAdd} to add${toCopy ? `, ${toCopy} extra ${toCopy === 1 ? "copy" : "copies"}` : ""}, ${skipped} skipped.${lookingUp ? " Some are still looking up." : ""}`}
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
      </SheetContent>
    </Sheet>
  );
}
