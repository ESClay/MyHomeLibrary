"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeBook, canEdit, fail, firstIssue, roleInLibrary, type ActionResult } from "@/lib/books/access";
import { fullAccessDenied, hasFullAccess } from "@/lib/access";
import { requireUser } from "@/lib/library";
import { capMessage } from "@/lib/scan/photo";
import { dailyScanStatus, SCANS_BUCKET } from "@/lib/scan/jobs";
import { createClient } from "@/lib/supabase/server";

const startSchema = z.object({
  libraryId: z.string().uuid(),
  photoPath: z.string().max(200),
});

const FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

/**
 * Registers an uploaded photo as a scan job. Checks the person may edit the library, that the photo sits
 * under their own folder, and that they are under today's cap. The model is called later, by /api/scan/<id>.
 */
export async function startScan(
  input: z.input<typeof startSchema>,
): Promise<ActionResult<{ jobId: string; remaining: number }> & { capReached?: boolean }> {
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { libraryId, photoPath } = parsed.data;

  const user = await requireUser();
  // Photo recognition calls Claude, so it is for people with full access only.
  if (!(await hasFullAccess(await createClient(), user.id))) return fullAccessDenied();
  const role = await roleInLibrary(libraryId, user.id);
  if (!canEdit(role)) return fail(role ? "Only owners and editors can change the library." : "You are not a member of that library.");

  const [prefix, owner, file, ...rest] = photoPath.split("/");
  if (prefix !== libraryId || owner !== user.id || !file || !FILE.test(file) || rest.length > 0) {
    return fail("That photo is not in your folder.");
  }

  const supabase = await createClient();
  const status = await dailyScanStatus(supabase, user.id);
  if (status.reached) return { ...fail(capMessage(status.cap)), capReached: true };

  const { data, error } = await supabase
    .from("scan_jobs")
    .insert({ library_id: libraryId, photo_path: photoPath })
    .select("id")
    .single();
  if (error || !data) return fail(error?.message ?? "Could not start reading that photo.");
  return { ok: true, jobId: data.id, remaining: status.remaining - 1 };
}

/**
 * Copies the scan photo into the public covers bucket under the book's library and makes it the book's cover.
 * Must run before the photo is deleted, so the review saves books first and clears the photo last.
 */
export async function setCoverFromScan(input: { jobId: string; bookId: string }): Promise<ActionResult> {
  const parsed = z.object({ jobId: z.string().uuid(), bookId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const auth = await authorizeBook(parsed.data.bookId, true);
  if (!auth.ok) return fail(auth.error);

  const supabase = await createClient();
  const { data: job } = await supabase
    .from("scan_jobs")
    .select("id, library_id, photo_path, photo_deleted_at")
    .eq("id", parsed.data.jobId)
    .maybeSingle();
  if (!job || job.photo_deleted_at) return fail("That photo is no longer available.");
  if (job.library_id !== auth.book.library_id) return fail("That photo belongs to a different library.");

  const { data: blob, error: dlError } = await supabase.storage.from(SCANS_BUCKET).download(job.photo_path);
  if (dlError || !blob) return fail("The photo could not be read.");

  const path = `${auth.book.library_id}/${randomUUID()}.jpg`;
  const { error: upError } = await supabase.storage.from("covers").upload(path, blob, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
  });
  if (upError) return fail(upError.message);
  const { data: pub } = supabase.storage.from("covers").getPublicUrl(path);

  const { error } = await supabase.from("books").update({ cover_url: pub.publicUrl }).eq("id", auth.book.id);
  if (error) return fail(error.message);
  revalidatePath(`/books/${auth.book.id}`);
  revalidatePath("/library");
  return { ok: true };
}
