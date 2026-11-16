"use client";

import { useCallback, useState } from "react";
import { PageHeader } from "@/components/shelf";
import type { LibraryIndexBook } from "@/lib/calibre/classify";
import type { ActiveImport } from "@/lib/calibre/jobs";
import type { JobMapping, JobRow } from "@/lib/calibre/plan";
import { defaultValueMap, distinctValues, suggestColumns } from "@/lib/calibre/read-map";
import { EMPTY_MAPPING, type ImportAction, type ParsedCatalog, type ReadMapping } from "@/lib/calibre/types";
import { Button } from "@/components/ui/button";
import { cancelImport, loadLibraryIndex } from "./actions";
import { ExportStep } from "./export-step";
import { MapStep } from "./map-step";
import { ReviewStep } from "./review-step";
import { RunStep, type RunSource } from "./run-step";
import { Stepper, type StepId } from "./stepper";
import { UploadStep } from "./upload-step";
import { cn } from "@/lib/utils";

const n = (v: number) => v.toLocaleString("en");

/** The page is a Stepper over five steps. A reload with an unfinished import starts on the Resume card. */
export function ImportScreen({ libraryId, libraryName, resume }: { libraryId: string; libraryName: string; resume: ActiveImport | null }) {
  const [resuming, setResuming] = useState<ActiveImport | null>(resume);
  const [step, setStep] = useState<StepId>("export");
  const [catalog, setCatalog] = useState<ParsedCatalog | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ReadMapping>(EMPTY_MAPPING);
  const [overrides, setOverrides] = useState<Map<number, ImportAction>>(new Map());
  const [enrich, setEnrich] = useState(true);
  const [index, setIndex] = useState<LibraryIndexBook[] | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [run, setRun] = useState<RunSource | null>(null);
  const [resumeRun, setResumeRun] = useState(false);

  const fetchIndex = useCallback(async () => {
    setIndexError(null);
    setIndex(null);
    try {
      const res = await loadLibraryIndex(libraryId);
      if (res.ok) setIndex(res.books);
      else setIndexError(res.error);
    } catch {
      setIndexError("Your library could not be loaded. Check your connection and try again.");
    }
  }, [libraryId]);

  function parsed(next: ParsedCatalog, name: string) {
    // Start loading the library now, so the review screen opens ready.
    void fetchIndex();
    setCatalog(next);
    setFileName(name);
    setOverrides(new Map());
    const guess = suggestColumns(next.rows, next.customColumns);
    setMapping({
      statusColumn: guess.status,
      dateColumn: guess.date,
      valueMap: guess.status ? defaultValueMap(distinctValues(next.rows, guess.status)) : {},
    });
  }

  function begin(rows: JobRow[], skippedInReview: number) {
    const jobMapping: JobMapping = { ...mapping, enrich, expected: rows.length };
    setRun({ kind: "fresh", libraryId, rows, skippedInReview, mapping: jobMapping });
    setStep("run");
  }

  function again() {
    setRun(null);
    setResuming(null);
    setResumeRun(false);
    setCatalog(null);
    setFileName(null);
    setIndex(null);
    setOverrides(new Map());
    setStep("export");
  }

  async function startOver() {
    if (resuming) await cancelImport(resuming.id).catch(() => {});
    again();
  }

  const wide = step === "review" && !resuming;
  const showResume = resuming && !resumeRun;

  return (
    <div className={cn("mx-auto flex w-full flex-col gap-6", wide ? "max-w-5xl" : "max-w-3xl")}>
      <PageHeader
        eyebrow="New arrivals"
        title="Import from Calibre"
        lede={`Bring a Calibre catalog into ${libraryName}. You review every book before anything is saved.`}
      />

      {showResume ? (
        <section aria-labelledby="resume-h" className="panel rise flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-col gap-1">
            <h2 id="resume-h" className="font-display text-xl leading-snug font-medium">
              An import is waiting
            </h2>
            <p className="text-sm text-muted-foreground">
              {n(resuming.processed)} of {n(resuming.total)} books are done. Resume to carry on from there: nothing is saved twice.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              size="lg"
              onClick={() => {
                setRun({ kind: "resume", jobId: resuming.id, total: resuming.total, processed: resuming.processed, summary: resuming.summary, enrich: resuming.mapping.enrich });
                setResumeRun(true);
                setStep("run");
              }}
            >
              Resume the import
            </Button>
            <Button type="button" size="lg" variant="outline" onClick={() => void startOver()}>
              Discard it and start over
            </Button>
          </div>
        </section>
      ) : (
        <>
          <Stepper current={step} />
          {step === "export" && <ExportStep libraryName={libraryName} onNext={() => setStep("upload")} />}
          {step === "upload" && (
            <UploadStep catalog={catalog} fileName={fileName} onParsed={parsed} onBack={() => setStep("export")} onNext={() => setStep("read")} />
          )}
          {step === "read" && catalog && (
            <MapStep
              rows={catalog.rows}
              columns={catalog.customColumns}
              mapping={mapping}
              onChange={setMapping}
              onBack={() => setStep("upload")}
              onNext={() => setStep("review")}
            />
          )}
          {step === "review" && catalog && (
            <ReviewStep
              rows={catalog.rows}
              index={index}
              indexError={indexError}
              mapping={mapping}
              overrides={overrides}
              setOverrides={setOverrides}
              enrich={enrich}
              setEnrich={setEnrich}
              onBack={() => setStep("read")}
              onStart={begin}
              onRetryIndex={() => void fetchIndex()}
            />
          )}
          {step === "run" && run && <RunStep source={run} onAgain={again} />}
        </>
      )}
    </div>
  );
}
