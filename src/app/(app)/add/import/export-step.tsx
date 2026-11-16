import { Button } from "@/components/ui/button";

const FIELDS = ["title", "authors", "series", "series_index", "isbn", "identifiers", "comments", "pubdate", "publisher", "formats", "uuid"];

function Item({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5 text-base leading-snug">{children}</div>
    </li>
  );
}

export function ExportStep({ libraryName, onNext }: { libraryName: string; onNext: () => void }) {
  return (
    <section aria-labelledby="export-h" className="panel rise flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 id="export-h" className="font-display text-xl leading-snug font-medium">
          Export your catalog from Calibre
        </h2>
        <p className="text-sm text-muted-foreground">
          Calibre saves its book list as a CSV file. Do this on the computer where Calibre is installed. Books land in {libraryName} as e-books.
        </p>
      </div>
      <ol className="flex flex-col gap-5">
        <Item n={1}>
          <p>
            In the toolbar, open <strong>Convert books</strong> and choose <strong>Create a catalog of the books in your calibre library</strong>.
          </p>
        </Item>
        <Item n={2}>
          <p>
            In the Generate catalog window, set <strong>Catalog format</strong> to <strong>CSV</strong>.
          </p>
        </Item>
        <Item n={3}>
          <p>
            Under <strong>Fields to include in output</strong>, tick these. Only the title is required.
          </p>
          <ul className="flex flex-wrap gap-1.5" aria-label="Fields to tick">
            {FIELDS.map((f) => (
              <li key={f} className="rounded-md bg-secondary px-2 py-1 font-mono text-[0.8125rem]">
                {f}
              </li>
            ))}
            <li className="rounded-md border border-dashed border-gilt px-2 py-1 text-[0.8125rem]">your read column</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Your read column is a custom column. It appears in the file with a # in front of its name. Ratings and tags are never imported.
          </p>
        </Item>
        <Item n={4}>
          <p>
            Click <strong>OK</strong> and save the file. It ends in <span className="font-mono text-[0.9375rem]">.csv</span>.
          </p>
        </Item>
      </ol>
      <div>
        <Button type="button" size="lg" className="w-full sm:w-auto" onClick={onNext}>
          I have the file
        </Button>
      </div>
    </section>
  );
}
