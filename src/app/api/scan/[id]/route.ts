import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { identifyBooks, IdentifyError } from "@/lib/ai/identify";
import { findDuplicates } from "@/lib/duplicates";
import { loadDuplicateCandidates } from "@/lib/books/data";
import { fullAccessResponse, hasFullAccess } from "@/lib/access";
import { ALL_PROVIDERS, lookupByIsbn, search } from "@/lib/metadata";
import { createLimiter } from "@/lib/scan/limiter";
import { SCANS_BUCKET } from "@/lib/scan/jobs";
import { MAX_DOWNLOAD_BYTES, MAX_MODEL_IMAGE_BYTES, sniffImageType } from "@/lib/scan/photo";
import { resolveAll, toScanItems, type ScanItem } from "@/lib/scan/resolve";
import type { TrayDuplicate } from "@/lib/scan/tray";
import { createClient } from "@/lib/supabase/server";

// A full shelf at high effort can take a minute or more, then every title is looked up. Vercel's
// default would cut that off, so ask for the platform maximum for this route.
export const maxDuration = 300;

type Failure = { ok: false; error: string; kind: string };
const failure = (status: number, kind: string, error: string) =>
  NextResponse.json({ ok: false, error, kind } satisfies Failure, { status });

/**
 * POST /api/scan/<job id>: reads the job's photo, identifies the books, resolves each against the
 * catalogue and the library, stores the result on the job and returns it.
 */
export async function POST(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = z.string().uuid().safeParse((await ctx.params).id);
  if (!id.success) return failure(400, "bad_request", "That scan is not valid.");

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return failure(401, "auth", "Sign in first.");
  // Claude reads the photo and Hardcover/Google resolve the titles: full access only, checked before anything is claimed or sent.
  if (!(await hasFullAccess(supabase, auth.user.id))) return fullAccessResponse({ kind: "full_access_required" });

  const { data: job } = await supabase
    .from("scan_jobs")
    .select("id, library_id, photo_path, status, detected, photo_deleted_at")
    .eq("id", id.data)
    .maybeSingle();
  if (!job) return failure(404, "not_found", "That scan could not be found.");
  if (job.status === "ready" || job.status === "saved") {
    return NextResponse.json({ ok: true, items: job.detected as ScanItem[], dropped: 0 });
  }
  if (job.photo_deleted_at) return failure(410, "gone", "That photo has already been cleared. Take it again.");

  // Claim the job; only one request may run it.
  const { data: claimed } = await supabase
    .from("scan_jobs")
    .update({ status: "processing", error: null })
    .eq("id", job.id)
    .eq("status", "pending")
    .select("id");
  if (!claimed || claimed.length === 0) return failure(409, "busy", "That photo is already being read.");

  const fail = async (status: number, kind: string, message: string, usage?: { inputTokens: number; outputTokens: number }) => {
    await supabase
      .from("scan_jobs")
      .update({ status: "failed", error: message, input_tokens: usage?.inputTokens ?? null, output_tokens: usage?.outputTokens ?? null })
      .eq("id", job.id);
    return failure(status, kind, message);
  };

  try {
    const { data: blob, error: dlError } = await supabase.storage.from(SCANS_BUCKET).download(job.photo_path);
    if (dlError || !blob) return await fail(404, "not_found", "The photo could not be found. Take it again.");
    if (blob.size > MAX_DOWNLOAD_BYTES) return await fail(413, "too_big", "That photo is too large.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length > MAX_MODEL_IMAGE_BYTES) return await fail(413, "too_big", "That photo is too large. Try again with a smaller one.");
    const mediaType = sniffImageType(bytes);
    if (!mediaType) return await fail(415, "bad_image", "That photo type is not supported. Use a JPEG, PNG or WebP image.");

    const result = await identifyBooks({ base64: Buffer.from(bytes).toString("base64"), mediaType });

    const resolutions = await resolveAll(result.books, {
      lookupByIsbn: (isbn) => lookupByIsbn(isbn, ALL_PROVIDERS),
      search: (q) => search(q, ALL_PROVIDERS),
    });
    const dupRun = createLimiter(4);
    const duplicates: TrayDuplicate[][] = await Promise.all(
      resolutions.map((r) =>
        dupRun(async () => {
          if (!r.best) return [];
          const existing = await loadDuplicateCandidates(job.library_id, { title: r.best.title, isbn13: r.best.isbn13 });
          return findDuplicates({ title: r.best.title, authors: r.best.authors, isbn13: r.best.isbn13 }, existing).map((m) => ({
            id: m.book.id,
            title: m.book.title,
            authors: m.book.authors,
            reason: m.reason,
          }));
        }),
      ),
    );

    const items = toScanItems(result.books, resolutions, duplicates);
    await supabase
      .from("scan_jobs")
      .update({
        status: "ready",
        detected: items,
        error: null,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
      })
      .eq("id", job.id);
    return NextResponse.json({ ok: true, items, dropped: result.dropped });
  } catch (e) {
    if (e instanceof IdentifyError) {
      const status = e.kind === "busy" ? 429 : e.kind === "config" ? 503 : 502;
      return await fail(status, e.kind, e.message, e.usage);
    }
    console.error("[scan] unexpected failure", e instanceof Error ? e.message : e);
    return await fail(500, "failed", "Something went wrong reading that photo. Try again.");
  }
}
