"use client";

import { useRef, useState } from "react";
import { CircleAlert, FileSpreadsheet, LoaderCircle, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseCatalogFile } from "@/lib/calibre/client";
import type { ParsedCatalog } from "@/lib/calibre/types";
import { cn } from "@/lib/utils";

const n = (v: number) => v.toLocaleString("en");

export function UploadStep({
  catalog,
  fileName,
  onParsed,
  onBack,
  onNext,
}: {
  catalog: ParsedCatalog | null;
  fileName: string | null;
  onParsed: (catalog: ParsedCatalog, fileName: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [fraction, setFraction] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function take(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    setFraction(0);
    try {
      const parsed = await parseCatalogFile(file, setFraction);
      if (parsed.fatal) setError(parsed.fatal);
      else if (parsed.rows.length === 0) setError("That file has a header row but no books.");
      else onParsed(parsed, file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The file could not be read.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const customCount = catalog?.customColumns.length ?? 0;
  const hasIsbn = catalog ? catalog.recognized.includes("isbn") || catalog.recognized.includes("identifiers") : false;
  const bad = catalog ? catalog.rows.filter((r) => r.error).length : 0;

  return (
    <section aria-labelledby="upload-h" className="panel rise flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id="upload-h" className="font-display text-xl leading-snug font-medium">
          Choose the CSV file
        </h2>
        <p className="text-sm text-muted-foreground">The file stays in your browser until you confirm the import. Nothing is saved yet.</p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void take(e.dataTransfer.files[0]);
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors duration-[var(--dur)]",
          dragging ? "border-primary bg-accent" : "border-border",
        )}
      >
        {busy ? (
          <>
            <LoaderCircle aria-hidden className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" />
            <p role="status" className="text-sm">
              Reading the file… {Math.round(fraction * 100)}%
            </p>
          </>
        ) : (
          <>
            <FileSpreadsheet aria-hidden className="size-7 text-muted-foreground" strokeWidth={1.5} />
            <p className="hidden text-sm text-muted-foreground sm:block">Drop the file here, or</p>
            <input ref={input} id="calibre-file" type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => void take(e.target.files?.[0])} />
            <Button type="button" size="lg" variant={catalog ? "outline" : "default"} onClick={() => input.current?.click()}>
              <Upload aria-hidden /> {catalog ? "Choose a different file" : "Choose the CSV file"}
            </Button>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}

      {catalog && !error && (
        <div className="flex flex-col gap-3 rounded-lg bg-secondary/60 p-4">
          <p role="status" className="font-display text-lg leading-snug font-medium">
            Read {n(catalog.rows.length)} {catalog.rows.length === 1 ? "book" : "books"} from {fileName}
          </p>
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="font-semibold">Columns used</dt>
            <dd className="text-muted-foreground">{catalog.recognized.join(", ")}</dd>
            <dt className="font-semibold">Custom columns</dt>
            <dd className="text-muted-foreground">
              {customCount === 0 ? "None" : catalog.customColumns.map((c) => `${c.header} (${n(c.filled)} filled)`).join(", ")}
            </dd>
          </dl>
          {!hasIsbn && <p className="text-sm text-muted-foreground">There is no ISBN column, so matches with your library rely on title and author.</p>}
          {bad > 0 && <p className="text-sm text-muted-foreground">{n(bad)} {bad === 1 ? "row needs" : "rows need"} attention and will be flagged on the review screen.</p>}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back to the export steps
        </Button>
        <Button type="button" size="lg" disabled={!catalog || busy || !!error} onClick={onNext}>
          Continue to read status
        </Button>
      </div>
    </section>
  );
}
