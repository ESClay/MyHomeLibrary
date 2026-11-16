/** From reviewed rows to job rows, and the batch/ETA arithmetic the runner uses. Pure. */
import { z } from "zod";
import { STATUSES } from "@/lib/books/constants";
import { effectiveAction, type Classification } from "./classify";
import {
  BATCH_SIZE,
  JOB_DESCRIPTION_MAX,
  SECONDS_PER_ENRICHED_ROW,
  SECONDS_PER_PLAIN_ROW,
} from "./limits";
import { applyMapping } from "./read-map";
import type { CalibreRow, ImportAction, ReadMapping } from "./types";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** One row of work in an import job. Rows the person skipped are never stored. */
export const jobRowSchema = z.object({
  /** Row number in the catalog, for messages. */
  n: z.number().int().min(1),
  action: z.enum(["add", "copy"]),
  /** The library book a "copy" row adds to. */
  targetBookId: z.string().uuid().nullable(),
  title: z.string().trim().min(1).max(300),
  authors: z.array(z.string().trim().min(1).max(200)).max(20),
  series: z.string().max(200).nullable(),
  seriesPosition: z.number().min(0).max(10000).nullable(),
  isbn13: z.string().regex(/^\d{13}$/).nullable(),
  description: z.string().max(10000).nullable(),
  publishedDate: z.string().max(40).nullable(),
  calibreUuid: z.string().max(100).nullable(),
  status: z.enum(STATUSES).nullable(),
  finishedAt: date.nullable(),
});
export type JobRow = z.infer<typeof jobRowSchema>;

/** The import's settings, stored on the job. */
export const jobMappingSchema = z.object({
  statusColumn: z.string().max(200).nullable(),
  dateColumn: z.string().max(200).nullable(),
  valueMap: z.record(z.string(), z.enum(["want", "reading", "read", "dnf", "ignore"])),
  /** Look every new book up for covers and missing details. */
  enrich: z.boolean(),
  /** How many rows the job should hold once the upload is complete. */
  expected: z.number().int().min(0),
});
export type JobMapping = z.infer<typeof jobMappingSchema>;

export type PlanEntry = { row: CalibreRow; classification: Classification; override: ImportAction | undefined };

/** Builds the rows to save, in catalog order, leaving out everything skipped. */
export function buildJobRows(entries: PlanEntry[], mapping: ReadMapping): JobRow[] {
  const out: JobRow[] = [];
  for (const { row, classification, override } of entries) {
    const action = effectiveAction(classification, override);
    if (action === "skip") continue;
    const read = applyMapping(row, mapping);
    if (action === "copy") {
      out.push({
        n: row.n,
        action: "copy",
        targetBookId: classification.match?.id ?? null,
        title: row.title,
        authors: [],
        series: null,
        seriesPosition: null,
        isbn13: row.isbn13,
        description: null,
        publishedDate: null,
        calibreUuid: null,
        status: read.status,
        finishedAt: read.finishedAt,
      });
      continue;
    }
    // A row that repeats an earlier one in the file must not claim the same uuid twice.
    const fileRepeat = classification.repeatOf !== null;
    out.push({
      n: row.n,
      action: "add",
      targetBookId: null,
      title: row.title,
      authors: row.authors,
      series: row.series,
      seriesPosition: row.seriesPosition,
      isbn13: row.isbn13,
      description:
        row.description && row.description.length > JOB_DESCRIPTION_MAX
          ? `${row.description.slice(0, JOB_DESCRIPTION_MAX - 1)}…`
          : row.description,
      publishedDate: row.publishedDate,
      calibreUuid: fileRepeat ? null : row.calibreUuid,
      status: read.status,
      finishedAt: read.finishedAt,
    });
  }
  return out;
}

/** [from, to) index ranges that cover rows `processed`..`total` in batches. */
export function batchRanges(total: number, processed: number, size = BATCH_SIZE): [number, number][] {
  const out: [number, number][] = [];
  for (let from = Math.max(0, processed); from < total; from += size) out.push([from, Math.min(from + size, total)]);
  return out;
}

/** Splits rows into upload chunks. */
export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Whole seconds an import of this many rows should take, before it starts. */
export function estimateSeconds(addRows: number, copyRows: number, enrich: boolean): number {
  return Math.round(addRows * (enrich ? SECONDS_PER_ENRICHED_ROW : SECONDS_PER_PLAIN_ROW) + copyRows * SECONDS_PER_PLAIN_ROW);
}

/**
 * Seconds left, from the average time per row over the batches so far. Falls back to `fallbackPerRow`
 * until a batch has finished. Null when nothing is left.
 */
export function etaSeconds(remaining: number, doneRows: number, elapsedMs: number, fallbackPerRow: number): number | null {
  if (remaining <= 0) return null;
  const perRow = doneRows > 0 && elapsedMs > 0 ? elapsedMs / 1000 / doneRows : fallbackPerRow;
  return Math.max(1, Math.round(remaining * perRow));
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 45) return "under a minute";
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `about ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `about ${h} ${h === 1 ? "hour" : "hours"}` : `about ${h} h ${m} min`;
}

// ---------------------------------------------------------------- results

export type RowOutcome = "added" | "copied" | "skipped" | "failed";

export type RowResult = {
  n: number;
  title: string;
  outcome: RowOutcome;
  /** Why a row failed, or was left alone. */
  message?: string;
  /** The book was saved but something minor went wrong (the read could not be recorded). */
  warning?: string;
  /** Covers and details were filled in from a catalogue. */
  enriched: boolean;
};

export type ImportIssue = { n: number; title: string; message: string };

/** Running totals stored on the job, so a reloaded page shows the same numbers. */
export type ImportSummary = {
  added: number;
  copied: number;
  skipped: number;
  failed: number;
  enriched: number;
  /** Rows the person skipped on the review screen. */
  skippedInReview: number;
  issues: ImportIssue[];
};

export const emptySummary = (skippedInReview = 0): ImportSummary => ({
  added: 0,
  copied: 0,
  skipped: 0,
  failed: 0,
  enriched: 0,
  skippedInReview,
  issues: [],
});

/** Reads a stored summary defensively; anything missing counts as zero. */
export function readSummary(raw: unknown): ImportSummary {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (k: string) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : 0);
  const issues = Array.isArray(o.issues)
    ? (o.issues as unknown[]).flatMap((i) => {
        const r = i as Partial<ImportIssue>;
        return typeof r?.n === "number" && typeof r.message === "string" ? [{ n: r.n, title: String(r.title ?? ""), message: r.message }] : [];
      })
    : [];
  return {
    added: num("added"),
    copied: num("copied"),
    skipped: num("skipped"),
    failed: num("failed"),
    enriched: num("enriched"),
    skippedInReview: num("skippedInReview"),
    issues,
  };
}

/** Adds a batch's results to the totals. Skips and failures with a reason go on the issue list, up to `maxIssues`. */
export function mergeSummary(prev: ImportSummary, results: RowResult[], maxIssues: number): ImportSummary {
  const next: ImportSummary = { ...prev, issues: [...prev.issues] };
  for (const r of results) {
    if (r.outcome === "added") next.added++;
    else if (r.outcome === "copied") next.copied++;
    else if (r.outcome === "skipped") next.skipped++;
    else next.failed++;
    if (r.enriched) next.enriched++;
    const message = r.outcome === "failed" ? r.message : (r.warning ?? undefined);
    if (message && next.issues.length < maxIssues) next.issues.push({ n: r.n, title: r.title, message });
  }
  return next;
}
