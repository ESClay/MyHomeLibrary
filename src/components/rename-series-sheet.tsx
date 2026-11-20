"use client";

import { useMemo, useState, useTransition } from "react";
import { renameSeries } from "@/app/(app)/library/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { foldSeries, type SeriesOption } from "@/lib/books/series-suggest";

const ALL = "";

/**
 * Rename one series across the library, or merge it into another by giving it that name. If the series has books by more
 * than one author, the change can be limited to one of them. Only owners and editors reach this sheet.
 */
export function RenameSeriesSheet({
  libraryId,
  series,
  options,
  onClose,
  onDone,
}: {
  libraryId: string;
  series: string;
  options: readonly SeriesOption[];
  onClose: () => void;
  /** Called with the new name and the success message once the rename went through. */
  onDone: (newName: string, message: string) => void;
}) {
  const [to, setTo] = useState(series);
  const [author, setAuthor] = useState(ALL);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const authors = useMemo(() => {
    const f = foldSeries(series);
    return [...new Set(options.filter((o) => foldSeries(o.name) === f && o.author).map((o) => o.author))].sort((a, b) => a.localeCompare(b));
  }, [options, series]);

  const name = to.trim();
  const unchanged = name === "" || name === series;
  const existing = useMemo(() => {
    const f = foldSeries(name);
    return name !== series && options.some((o) => o.name !== series && foldSeries(o.name) === f);
  }, [options, name, series]);
  const scope = author === ALL ? "every book in the series" : `only books by ${author}`;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (unchanged || pending) return;
    setError(null);
    start(async () => {
      const res = await renameSeries({ libraryId, from: series, to: name, author: author || undefined });
      if (!res.ok) return setError(res.error);
      onDone(name, `Renamed ${res.count} ${res.count === 1 ? "book" : "books"}.`);
      onClose();
    });
  }

  return (
    <Sheet open onOpenChange={(o) => !o && !pending && onClose()}>
      <SheetContent title="Rename series" description={series}>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-semibold">New name</span>
              <Input value={to} onChange={(e) => setTo(e.target.value)} maxLength={200} autoComplete="off" disabled={pending} autoFocus />
            </label>
            {authors.length > 1 && (
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="text-sm font-semibold">Which books</span>
                <NativeSelect value={author} onChange={(e) => setAuthor(e.target.value)} disabled={pending}>
                  <option value={ALL}>Every author</option>
                  {authors.map((a) => (
                    <option key={a} value={a}>
                      Only {a}
                    </option>
                  ))}
                </NativeSelect>
                <span className="text-sm text-muted-foreground">This series has books by {authors.length} authors.</span>
              </label>
            )}
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {unchanged
                ? "Type the new name. Upper and lower case and accents count as the same series."
                : `Changes “${series}” to “${name}” on ${scope}.${existing ? ` A series named “${name}” already exists, so these books will join it.` : ""}`}
            </p>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <div className="border-t border-border bg-card px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button type="submit" size="lg" className="w-full" disabled={pending || unchanged}>
              {pending ? "Saving…" : "Save new name"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
