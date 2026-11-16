"use client";

import { useState, useTransition } from "react";
import { HandHelping, Pencil, Plus, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { addCopy, deleteCopy, updateCopy } from "@/app/(app)/books/actions";
import { checkCopyPrice } from "@/app/(app)/books/price-actions";
import { markReturned } from "@/app/(app)/loans/actions";
import { CopyFields, Field, copyDraftToInput, emptyCopyDraft, type CopyDraft } from "@/components/book-forms";
import type { BorrowerOption } from "@/components/borrower-picker";
import { Sparkline } from "@/components/charts/sparkline";
import { useLocale } from "@/components/locale-provider";
import { LoanLine, LoanTag } from "@/components/loan-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { CONDITION_LABEL, FORMAT_LABEL } from "@/lib/books/constants";
import type { CopyRow, PricePoint } from "@/lib/books/data";
import { activeLoans, lendBlocker, type LoanLite } from "@/lib/loans/rules";
import { isPhysicalFormat } from "@/lib/pricing/compute";
import { formatDate, formatMoney, getRegion } from "@/lib/regions";
import { LendSheet } from "./lend-sheet";

function toDraft(c: CopyRow): CopyDraft {
  return {
    format: c.format,
    condition: c.condition ?? "",
    editionIsbn: c.edition_isbn ?? "",
    purchasePrice: c.purchase_price === null ? "" : String(c.purchase_price),
    purchaseDate: c.purchase_date ?? "",
  };
}

type Props = {
  bookId: string;
  copies: CopyRow[];
  canEdit: boolean;
  loans: LoanLite[];
  history: Record<string, PricePoint[]>;
  borrowers: BorrowerOption[];
  /** The library's currency; null while the library has no price region. */
  currency: string | null;
  priceRegion: string | null;
  /** Server clock at render, so Overdue is decided once. */
  nowIso: string;
};

export function CopiesSection({ bookId, copies, canEdit, loans, history, borrowers, currency, priceRegion, nowIso }: Props) {
  const locale = useLocale();
  const [sheet, setSheet] = useState<{ copy: CopyRow | null } | null>(null);
  const [lending, setLending] = useState<CopyRow | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const active = activeLoans(loans, new Date(nowIso));

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteCopy(id);
      if (!res.ok) setError(res.error);
      setConfirming(null);
    });
  }

  function check(id: string) {
    setError(null);
    setBusy(id);
    startTransition(async () => {
      const res = await checkCopyPrice(id);
      if (res.ok) setNotes((n) => ({ ...n, [id]: `${res.message} ${res.left} checks left today.` }));
      else setError(res.error);
      setBusy(null);
    });
  }

  function giveBack(loanId: string) {
    setError(null);
    startTransition(async () => {
      const res = await markReturned({ loanId });
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {copies.length === 0 ? (
        <p className="text-base text-muted-foreground">No copies on the shelf yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {copies.map((c) => {
            const loan = active.find((l) => l.direction === "out" && l.copyId === c.id) ?? null;
            const physical = isPhysicalFormat(c.format);
            const points = history[c.id] ?? [];
            return (
              <li key={c.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold">
                      <span>
                        {FORMAT_LABEL[c.format]}
                        {c.condition && <span className="font-normal text-muted-foreground"> · {CONDITION_LABEL[c.condition]}</span>}
                      </span>
                      {loan && <LoanTag loan={loan} />}
                    </p>
                    {loan && <LoanLine loan={loan} className="mt-0.5 block" />}
                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
                      {c.purchase_price !== null && (
                        <>
                          <dt className="text-muted-foreground">Paid</dt>
                          <dd className="tabular-nums">{formatMoney(c.purchase_price, currency, locale)}</dd>
                        </>
                      )}
                      {c.purchase_date && (
                        <>
                          <dt className="text-muted-foreground">Bought</dt>
                          <dd>{formatDate(c.purchase_date, locale)}</dd>
                        </>
                      )}
                      {c.edition_isbn && (
                        <>
                          <dt className="text-muted-foreground">ISBN</dt>
                          <dd className="tabular-nums">{c.edition_isbn}</dd>
                        </>
                      )}
                    </dl>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0">
                      <Button type="button" variant="ghost" size="icon" aria-label={`Edit this ${FORMAT_LABEL[c.format]} copy`} onClick={() => setSheet({ copy: c })}>
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" aria-label={`Delete this ${FORMAT_LABEL[c.format]} copy`} onClick={() => setConfirming(c.id)}>
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                  )}
                </div>

                {physical && (
                  <PriceBlock
                    copy={c}
                    currency={currency}
                    priceRegion={priceRegion}
                    points={points}
                    canEdit={canEdit}
                    busy={busy === c.id}
                    disabled={pending}
                    note={notes[c.id]}
                    onCheck={() => check(c.id)}
                  />
                )}

                {canEdit && physical && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                    {loan ? (
                      <Button type="button" variant="outline" disabled={pending} onClick={() => giveBack(loan.id)}>
                        <Undo2 aria-hidden /> Mark returned
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={lendBlocker({ id: c.id, format: c.format }, active) !== null}
                        onClick={() => setLending(c)}
                      >
                        <HandHelping aria-hidden /> Lend this copy
                      </Button>
                    )}
                  </div>
                )}

                {confirming === c.id && (
                  <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center">
                    <p className="flex-1 text-sm">Delete this copy? This cannot be undone.</p>
                    <Button type="button" variant="destructive" disabled={pending} onClick={() => remove(c.id)}>
                      Delete copy
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setConfirming(null)}>
                      Keep it
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {canEdit && (
        <div>
          <Button type="button" variant="outline" onClick={() => setSheet({ copy: null })}>
            <Plus aria-hidden /> Add a copy
          </Button>
        </div>
      )}

      {sheet && <CopySheet bookId={bookId} copy={sheet.copy} currency={currency} onClose={() => setSheet(null)} />}
      {lending && (
        <LendSheet
          copyId={lending.id}
          label={`${FORMAT_LABEL[lending.format]}${lending.condition ? ` · ${CONDITION_LABEL[lending.condition]}` : ""}`}
          borrowers={borrowers}
          onClose={() => setLending(null)}
        />
      )}
    </div>
  );
}

/** One copy's market price: the figure, what it means, when it was checked, and how it has moved. */
function PriceBlock({
  copy,
  currency,
  priceRegion,
  points,
  canEdit,
  busy,
  disabled,
  note,
  onCheck,
}: {
  copy: CopyRow;
  currency: string | null;
  priceRegion: string | null;
  points: PricePoint[];
  canEdit: boolean;
  busy: boolean;
  disabled: boolean;
  note?: string;
  onCheck: () => void;
}) {
  const locale = useLocale();
  const region = getRegion(priceRegion);
  const hasPrice = copy.current_price !== null;
  const oldCurrency = hasPrice && currency !== null && copy.current_price_currency !== null && copy.current_price_currency !== currency;
  // Oldest first for the sparkline, and only prices in the currency of the latest one so the line never mixes currencies.
  const sameCurrency = points.filter((p) => p.currency === (points[0]?.currency ?? null));
  const series = [...sameCurrency].reverse();

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3" aria-label="Market price">
      {!currency ? (
        <p className="text-sm text-muted-foreground">Prices are off for this library until its owner chooses a price region in Settings.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              {hasPrice ? (
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-display text-2xl leading-none font-medium tabular-nums">{formatMoney(copy.current_price, copy.current_price_currency ?? currency, locale)}</span>
                  {copy.price_approximate && <Badge variant="outline">approximate</Badge>}
                  {oldCurrency && <Badge variant="destructive">old currency, check again</Badge>}
                </p>
              ) : copy.price_checked_at ? (
                <p className="text-base">No price found</p>
              ) : (
                <p className="text-base text-muted-foreground">Not checked yet</p>
              )}
              <p className="text-xs text-muted-foreground">
                {hasPrice ? "est. market (asking prices)" : region ? `eBay ${region.domain}` : ""}
                {copy.price_checked_at ? ` · checked ${formatDate(copy.price_checked_at, locale)}` : ""}
                {hasPrice && copy.price_listing_count ? ` · ${copy.price_listing_count} listings` : ""}
              </p>
              {hasPrice && copy.price_approximate && (
                <p className="text-xs text-muted-foreground">Too few listings in this condition, so similar copies were included.</p>
              )}
            </div>
            {series.length >= 2 && (
              <Sparkline
                values={series.map((p) => p.price)}
                label={`Price history: ${formatMoney(series[0].price, series[0].currency, locale)} to ${formatMoney(series[series.length - 1].price, series[series.length - 1].currency, locale)} over ${series.length} checks`}
              />
            )}
          </div>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={onCheck}>
                <RefreshCw aria-hidden className={busy ? "animate-spin" : undefined} /> {busy ? "Checking…" : "Check price"}
              </Button>
              {note && (
                <p role="status" className="text-xs text-muted-foreground">
                  {note}
                </p>
              )}
            </div>
          )}

          {points.length > 0 && (
            <details className="text-sm">
              <summary className="flex h-11 cursor-pointer items-center text-muted-foreground hover:text-foreground">Price history ({points.length})</summary>
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Past price checks for this copy, newest first</caption>
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th scope="col" className="py-1 pr-3 font-medium">
                      Checked
                    </th>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      Est. market
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      Note
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {points.slice(0, 12).map((p) => (
                    <tr key={p.checkedAt} className="border-t border-border">
                      <td className="py-1 pr-3">{formatDate(p.checkedAt, locale)}</td>
                      <td className="py-1 pr-3 tabular-nums">{formatMoney(p.price, p.currency, locale)}</td>
                      <td className="py-1 text-muted-foreground">{p.approximate ? "approximate" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function CopySheet({ bookId, copy, currency, onClose }: { bookId: string; copy: CopyRow | null; currency: string | null; onClose: () => void }) {
  const [draft, setDraft] = useState<CopyDraft>(copy ? toDraft(copy) : emptyCopyDraft);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const input = copyDraftToInput(draft);
      const res = copy ? await updateCopy({ copyId: copy.id, copy: input }) : await addCopy({ bookId, copy: input });
      if (res.ok) onClose();
      else setError(res.error);
    });
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={copy ? "Edit this copy" : "Add a copy"}>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
            <CopyFields draft={draft} onChange={setDraft} currency={currency} />
            <Field label="Edition ISBN" hint="Leave blank to use the book's ISBN.">
              {(id) => (
                <Input
                  id={id}
                  value={draft.editionIsbn}
                  onChange={(e) => setDraft({ ...draft, editionIsbn: e.target.value })}
                  inputMode="numeric"
                  maxLength={17}
                />
              )}
            </Field>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <div className="border-t border-border px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending ? "Saving…" : copy ? "Save copy" : "Add copy"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
