"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canEdit, fail, firstIssue, roleInLibrary, type ActionResult } from "@/lib/books/access";
import { runJobsTick } from "@/lib/jobs/queue/tick";
import { undoJobChanges, type UndoOutcome } from "@/lib/jobs/queue/undo";
import { requireUser } from "@/lib/library";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();

function revalidate() {
  revalidatePath("/activity");
  revalidatePath("/discover");
}

/** Cancels a queued or running job. The database allows this to the library owner and the person who started it, and nothing else. */
export async function cancelJob(jobId: string): Promise<ActionResult> {
  const parsed = uuid.safeParse(jobId);
  if (!parsed.success) return fail("That job is not valid.");
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("jobs").update({ status: "cancelled" }).eq("id", parsed.data).in("status", ["queued", "running"]).select("id");
  if (error) return fail("Could not cancel that job.");
  if (!data || data.length === 0) return fail("That job has already finished, or you cannot cancel it.");
  revalidate();
  return { ok: true };
}

/** Marks a finished job as seen, which clears it from the nav badge. */
export async function markJobSeen(jobId: string): Promise<ActionResult> {
  const parsed = uuid.safeParse(jobId);
  if (!parsed.success) return fail("That job is not valid.");
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update({ seen_at: new Date().toISOString() }).eq("id", parsed.data).is("seen_at", null);
  if (error) return fail("Could not mark that job as seen.");
  return { ok: true };
}

const NOT_EDITOR = "Only owners and editors can undo changes.";

async function undo(jobId: string, bookId?: string): Promise<ActionResult<UndoOutcome>> {
  const parsed = z.object({ jobId: uuid, bookId: uuid.optional() }).safeParse({ jobId, bookId });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const user = await requireUser();
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("id, library_id").eq("id", parsed.data.jobId).maybeSingle();
  if (!job) return fail("That job was not found.");
  const role = await roleInLibrary(job.library_id as string, user.id);
  if (!canEdit(role)) return fail(NOT_EDITOR);
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return fail("Undo is not configured on this server (SUPABASE_SERVICE_ROLE_KEY).");
  }
  try {
    const out = await undoJobChanges(admin, { jobId: parsed.data.jobId, libraryId: job.library_id as string, bookId: parsed.data.bookId });
    revalidate();
    revalidatePath("/library");
    return { ok: true, ...out };
  } catch {
    return fail("Could not undo that. Try again shortly.");
  }
}

/** Puts one book back the way it was, for the fields that still hold what the job wrote. Owner or editor only. */
export async function undoBookChange(input: { jobId: string; bookId: string }): Promise<ActionResult<UndoOutcome>> {
  return undo(input.jobId, input.bookId);
}

/** Undoes every change of a job, with the same per-field rule. Owner or editor only. */
export async function undoAllChanges(input: { jobId: string }): Promise<ActionResult<UndoOutcome>> {
  return undo(input.jobId);
}

/** Development only: works the queue now, since pg_cron cannot reach localhost. */
export async function runJobsNow(): Promise<ActionResult<{ message: string }>> {
  if (process.env.NODE_ENV === "production") return fail("Not available.");
  await requireUser();
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return fail("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }
  try {
    const res = await runJobsTick(admin, 50_000);
    revalidate();
    return { ok: true, message: res.jobs.length === 0 ? "No jobs were due." : `Worked ${res.jobs.length} job${res.jobs.length === 1 ? "" : "s"}: ${res.jobs.map((j) => j.outcome).join(", ")}.` };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "The tick failed.");
  }
}
