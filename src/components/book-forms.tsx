"use client";

import { useId } from "react";
import { useLocale } from "@/components/locale-provider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { CONDITIONS, CONDITION_LABEL, FORMATS, FORMAT_LABEL, type Condition, type Format, type Ownership } from "@/lib/books/constants";
import type { BookMetadata } from "@/lib/metadata/types";
import { currencyLabel } from "@/lib/regions";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- book fields

export type BookDraft = {
  title: string;
  subtitle: string;
  authors: string;
  seriesName: string;
  seriesPosition: string;
  pageCount: string;
  publishedDate: string;
  isbn13: string;
  genres: string;
  description: string;
};

export const emptyBookDraft: BookDraft = {
  title: "",
  subtitle: "",
  authors: "",
  seriesName: "",
  seriesPosition: "",
  pageCount: "",
  publishedDate: "",
  isbn13: "",
  genres: "",
  description: "",
};

export function draftFromMetadata(m: BookMetadata): BookDraft {
  return {
    title: m.title,
    subtitle: m.subtitle ?? "",
    authors: m.authors.join(", "),
    seriesName: m.seriesName ?? "",
    seriesPosition: m.seriesPosition === null ? "" : String(m.seriesPosition),
    pageCount: m.pageCount === null ? "" : String(m.pageCount),
    publishedDate: m.publishedDate ?? "",
    isbn13: m.isbn13 ?? "",
    genres: m.genres.join(", "),
    description: m.description ?? "",
  };
}

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/** The shape the server actions validate. Empty strings become null there. */
export function draftToFields(d: BookDraft, ownership: Ownership, coverUrl: string | null) {
  return {
    title: d.title,
    subtitle: d.subtitle,
    authors: list(d.authors),
    seriesName: d.seriesName,
    seriesPosition: d.seriesPosition,
    description: d.description,
    coverUrl,
    pageCount: d.pageCount,
    publishedDate: d.publishedDate,
    genres: list(d.genres),
    isbn13: d.isbn13.replace(/[\s-]/g, ""),
    ownership,
  };
}

export function BookFields({ draft, onChange }: { draft: BookDraft; onChange: (next: BookDraft) => void }) {
  const set = (k: keyof BookDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ ...draft, [k]: e.target.value });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Title">
          {(id) => <Input id={id} value={draft.title} onChange={set("title")} required maxLength={300} autoComplete="off" />}
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Subtitle">{(id) => <Input id={id} value={draft.subtitle} onChange={set("subtitle")} maxLength={300} />}</Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Authors" hint="Separate several authors with commas.">
          {(id) => <Input id={id} value={draft.authors} onChange={set("authors")} autoComplete="off" />}
        </Field>
      </div>
      <Field label="Series">{(id) => <Input id={id} value={draft.seriesName} onChange={set("seriesName")} maxLength={200} />}</Field>
      <Field label="Number in series">
        {(id) => <Input id={id} value={draft.seriesPosition} onChange={set("seriesPosition")} inputMode="decimal" placeholder="1" />}
      </Field>
      <Field label="Pages">
        {(id) => <Input id={id} value={draft.pageCount} onChange={set("pageCount")} inputMode="numeric" />}
      </Field>
      <Field label="Published">
        {(id) => <Input id={id} value={draft.publishedDate} onChange={set("publishedDate")} placeholder="2005 or 2005-08-02" maxLength={40} />}
      </Field>
      <div className="sm:col-span-2">
        <Field label="ISBN-13">
          {(id) => <Input id={id} value={draft.isbn13} onChange={set("isbn13")} inputMode="numeric" placeholder="9780441172719" maxLength={17} />}
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Genres" hint="Separate with commas.">
          {(id) => <Input id={id} value={draft.genres} onChange={set("genres")} />}
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Description">
          {(id) => <Textarea id={id} value={draft.description} onChange={set("description")} rows={5} maxLength={10000} />}
        </Field>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- copy fields

export type CopyDraft = {
  format: Format;
  condition: Condition | "";
  editionIsbn: string;
  purchasePrice: string;
  purchaseDate: string;
};

export const emptyCopyDraft: CopyDraft = {
  format: "paperback",
  condition: "",
  editionIsbn: "",
  purchasePrice: "",
  purchaseDate: "",
};

export function copyDraftToInput(c: CopyDraft) {
  return {
    format: c.format,
    condition: c.condition === "" ? null : c.condition,
    editionIsbn: c.editionIsbn.replace(/[\s-]/g, ""),
    purchasePrice: c.purchasePrice.replace(",", "."),
    purchaseDate: c.purchaseDate,
  };
}

export function CopyFields({ draft, onChange, currency }: { draft: CopyDraft; onChange: (next: CopyDraft) => void; currency?: string | null }) {
  const locale = useLocale();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Format">
        {(id) => (
          <NativeSelect id={id} value={draft.format} onChange={(e) => onChange({ ...draft, format: e.target.value as Format })}>
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
          <NativeSelect id={id} value={draft.condition} onChange={(e) => onChange({ ...draft, condition: e.target.value as Condition | "" })}>
            <option value="">Not set</option>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABEL[c]}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field
        label={currency ? `Price paid in ${currencyLabel(currency, locale)}` : "Price paid"}
        hint={currency ? "Enter it in your library's currency." : "Choose a price region in Settings to price this library in a currency."}
      >
        {(id) => (
          <Input
            id={id}
            value={draft.purchasePrice}
            onChange={(e) => onChange({ ...draft, purchasePrice: e.target.value })}
            inputMode="decimal"
            placeholder="0.00"
            autoComplete="off"
          />
        )}
      </Field>
      <Field label="Date bought">
        {(id) => (
          <Input id={id} type="date" value={draft.purchaseDate} onChange={(e) => onChange({ ...draft, purchaseDate: e.target.value })} />
        )}
      </Field>
    </div>
  );
}
