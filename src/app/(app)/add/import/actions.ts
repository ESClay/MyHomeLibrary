"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canEdit, fail, firstIssue, roleInLibrary, type ActionResult } from "@/lib/books/access";
import { createPacer, type PacerState } from "@/lib/calibre/pacer";
import {
  BATCH_BUDGET_MS,
  BATCH_SIZE,
  LOOKUP_GAP_MS,
  MAX_ROWS,
  MAX_STORED_ERRORS,
  RESUME_FETCH,
  UPLOAD_CHUNK,
} from "@/lib/calibre/limits";
import type { LibraryIndexBook } from "@/lib/calibre/classify";
import {
  emptySummary,
  jobMappingSchema,
  jobRowSchema,
  mergeSummary,
  readSummary,
  type ImportSummary,
  type JobRow,
  type RowResult,
} from "@/lib/calibre/plan";
import { processRow } from "@/lib/calibre/process";
import { attachBooksToShelves } from "@/lib/shelves/assign";
import { requireUser } from "@/lib/library";
import { providerPolicyFor } from "@/lib/access";
import { lookupByIsbn, rateLimitedSince, search } from "@/lib/metadata";
import { createClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const NOT_EDITOR = "Only owners and editors can change the library.";

/** Spacing between lookups carries over from one batch to the next on the same server instance. */
const pacerState: PacerState = { last: 0 };

async function editorOf(libraryId: string) {
  const user = await requireUser();
  const role = await roleInLibrary(libraryId, user.id);
  if (!canEdit(role)) return { ok: false as const, error: role ? NOT_EDITOR : "You are not a member of that library." };
  return { ok: true as const, user, role };
}

// ------------------------------------------------------------ the library

const PAGE = 1000;

/** Every book in the library, in the small shape the review screen needs to find duplicates. */
export async function loadLibraryIndex(libraryId: string): Promise<ActionResult<{ books: LibraryIndexBook[] }>> {
  const parsed = uuid.safeParse(libraryId);
  if (!parsed.success) return fail("That library id is not valid.");
  const who = await editorOf(parsed.data);
  if (!who.ok) return fail(who.error);

  const supabase = await createClient();
  const books: LibraryIndexBook[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("books")
      .select("id, title, authors, isbn13, calibre_uuid, copies(edition_isbn)")
      .eq("library_id", parsed.data)
      .order("created_at")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return fail(error.message);
    for (const r of data ?? []) {
      books.push({
        id: r.id as string,
        title: r.title as string,
        authors: (r.authors as string[]) ?? [],
        isbn13: (r.isbn13 as string | null) ?? null,
        calibreUuid: (r.calibre_uuid as string | null) ?? null,
        copyIsbns: ((r.copies as { edition_isbn: string | null }[] | null) ?? [])
          .map((c) => c.edition_isbn)
          .filter((s): s is string => !!s),
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return { ok: true, books };
}

// ------------------------------------------------------------ the job

const createSchema = z.object({
  libraryId: uuid,
  mapping: jobMappingSchema,
  skippedInReview: z.number().int().min(0).max(MAX_ROWS),
});

/** Starts an import job. The reviewed rows follow in chunks through uploadImportRows. */
export async function createImportJob(input: z.input<typeof createSchema>): Promise<ActionResult<{ jobId: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { libraryId, mapping, skippedInReview } = parsed.data;
  if (mapping.expected > MAX_ROWS) return fail(`An import can hold at most ${MAX_ROWS.toLocaleString("en")} books.`);
  const who = await editorOf(libraryId);
  if (!who.ok) return fail(who.error);

  const supabase = await createClient();
  // Only one unfinished import at a time, so "Resume" is never ambiguous: older ones are closed.
  await supabase
    .from("import_jobs")
    .update({ status: "cancelled" })
    .eq("user_id", who.user.id)
    .eq("library_id", libraryId)
    .in("status", ["pending", "running"]);

  const { data, error } = await supabase
    .from("import_jobs")
    .insert({
      library_id: libraryId,
      source: "calibre",
      status: "pending",
      total: 0,
      mapping,
      summary: emptySummary(skippedInReview),
    })
    .select("id")
    .single();
  if (error || !data) return fail(error?.message ?? "Could not start the import.");
  return { ok: true, jobId: data.id };
}

const uploadSchema = z.object({ jobId: uuid, rows: z.array(jobRowSchema).min(1).max(UPLOAD_CHUNK) });

/** Appends one chunk of reviewed rows. Returns how many rows the job now holds. */
export async function uploadImportRows(input: z.input<typeof uploadSchema>): Promise<ActionResult<{ total: number }>> {
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const user = await requireUser();
  void user;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_append_rows", { p_job: parsed.data.jobId, p_rows: parsed.data.rows });
  if (error) return fail(error.message);
  if (typeof data !== "number") return fail("That import is no longer open.");
  return { ok: true, total: data };
}

type JobRecord = {
  id: string;
  library_id: string;
  status: string;
  total: number;
  processed: number;
  mapping: unknown;
  summary: unknown;
  error: string | null;
};

async function loadJob(jobId: string): Promise<JobRecord | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("import_jobs")
    .select("id, library_id, status, total, processed, mapping, summary, error")
    .eq("id", jobId)
    .maybeSingle();
  return (data as JobRecord | null) ?? null;
}

export type BatchOk = {
  ok: true;
  /** The job's position after this call. If it differs from from + rows, the client resyncs. */
  processed: number;
  total: number;
  status: "running" | "done" | "cancelled";
  results: RowResult[];
  summary: ImportSummary;
  /** A catalogue said "too many requests": the client pauses before the next batch. */
  rateLimited: boolean;
  /** How many rows in this batch had no lookup slot left and were saved without extra details. */
  unenriched: number;
};

const batchSchema = z.object({
  jobId: uuid,
  from: z.number().int().min(0),
  rows: z.array(jobRowSchema).min(1).max(BATCH_SIZE),
});

/**
 * Saves up to ten reviewed rows. `from` must equal the job's `processed`, which makes a retried call harmless:
 * a batch that already went through just reports where the job is. A lookup problem or rate limit never fails a row.
 */
export async function processImportBatch(input: z.input<typeof batchSchema>): Promise<BatchOk | { ok: false; error: string; cancelled?: boolean }> {
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { jobId, from, rows } = parsed.data;

  const user = await requireUser();
  const job = await loadJob(jobId);
  if (!job) return fail("That import could not be found.");
  if (job.status === "cancelled") return { ok: false, error: "This import was cancelled.", cancelled: true };
  if (job.status === "done") {
    return { ok: true, processed: job.total, total: job.total, status: "done", results: [], summary: readSummary(job.summary), rateLimited: false, unenriched: 0 };
  }
  if (job.status === "failed") return fail(job.error ?? "This import stopped with an error.");
  const who = await editorOf(job.library_id);
  if (!who.ok) return fail(who.error);

  const summary0 = readSummary(job.summary);
  if (from !== job.processed || from + rows.length > job.total) {
    return { ok: true, processed: job.processed, total: job.total, status: "running", results: [], summary: summary0, rateLimited: false, unenriched: 0 };
  }

  const mapping = jobMappingSchema.safeParse(job.mapping);
  const enrich = mapping.success ? mapping.data.enrich : false;
  const supabase = await createClient();
  if (job.status === "pending") await supabase.from("import_jobs").update({ status: "running" }).eq("id", jobId);

  // Enrichment looks books up online: Hardcover and Google for people with full access, Open Library only otherwise.
  const policy = await providerPolicyFor(supabase, user.id);
  const startedAt = Date.now();
  const pacer = createPacer({ gapMs: LOOKUP_GAP_MS, budgetMs: BATCH_BUDGET_MS, state: pacerState });
  const ctx = {
    supabase,
    userId: user.id,
    libraryId: job.library_id,
    enrich,
    lookups: { lookupByIsbn: (isbn: string) => lookupByIsbn(isbn, policy), search: (q: string) => search(q, policy) },
    take: () => pacer.take(),
    limited: () => rateLimitedSince(startedAt),
    state: { rateLimited: false },
    touched: [] as string[],
  };

  const results: RowResult[] = [];
  for (const row of rows as JobRow[]) results.push(await processRow(ctx, row));

  // The shelves chosen at review get this batch's books. Idempotent, so a retried batch cannot double up.
  const shelfIds = mapping.success ? mapping.data.shelfIds : [];
  if (shelfIds.length > 0 && ctx.touched.length > 0) {
    try {
      await attachBooksToShelves(supabase, { userId: user.id, role: who.role, libraryId: job.library_id, shelfIds, bookIds: ctx.touched });
    } catch {
      // Shelves are a convenience: the books are saved either way.
    }
  }

  const processed = from + rows.length;
  const done = processed >= job.total;
  const summary = mergeSummary(summary0, results, MAX_STORED_ERRORS);
  const status = done ? "done" : "running";
  const { error } = await supabase.from("import_jobs").update({ processed, status, summary }).eq("id", jobId).eq("processed", from);
  if (error) return fail(error.message);

  revalidatePath("/library");
  const unenriched = enrich ? results.filter((r) => r.outcome === "added" && !r.enriched).length : 0;
  return { ok: true, processed, total: job.total, status, results, summary, rateLimited: ctx.state.rateLimited, unenriched };
}

const sliceSchema = z.object({ jobId: uuid, from: z.number().int().min(0), count: z.number().int().min(1).max(RESUME_FETCH) });

/** Rows [from, from + count) of a job, used to continue after a reload. */
export async function loadImportRows(input: z.input<typeof sliceSchema>): Promise<ActionResult<{ rows: JobRow[] }>> {
  const parsed = sliceSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_rows_slice", {
    p_job: parsed.data.jobId,
    p_from: parsed.data.from,
    p_count: parsed.data.count,
  });
  if (error) return fail(error.message);
  const rows = z.array(jobRowSchema).safeParse(data);
  if (!rows.success) return fail("The saved import could not be read.");
  return { ok: true, rows: rows.data };
}

/** Stops an import. Books already saved stay. */
export async function cancelImport(jobId: string): Promise<ActionResult> {
  const parsed = uuid.safeParse(jobId);
  if (!parsed.success) return fail("That import id is not valid.");
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("import_jobs")
    .update({ status: "cancelled" })
    .eq("id", parsed.data)
    .in("status", ["pending", "running"]);
  if (error) return fail(error.message);
  revalidatePath("/library");
  return { ok: true };
}
