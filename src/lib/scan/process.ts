import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { identifyBooks, IdentifyError } from "@/lib/ai/identify";
import { loadDuplicateCandidates } from "@/lib/books/data";
import { findDuplicates } from "@/lib/duplicates";
import { ALL_PROVIDERS, lookupByIsbn, search } from "@/lib/metadata";
import { createLimiter } from "./limiter";
import { SCANS_BUCKET } from "./jobs";
import { MAX_DOWNLOAD_BYTES, MAX_MODEL_IMAGE_BYTES, sniffImageType } from "./photo";
import { resolveAll, toScanItems, type ScanItem } from "./resolve";
import type { TrayDuplicate } from "./tray";

export type ScanFailure = { ok: false; status: number; kind: string; error: string };
export type ScanOutcome = { ok: true; items: ScanItem[]; dropped: number } | ScanFailure;

/**
 * Reads one scan photo: claims its scan_jobs row, downloads the photo, has the model identify the books, resolves each
 * against the catalogue and the library, and stores the result on the row. Shared by POST /api/scan/<id> (the person's
 * own client) and the background photo_scan worker (the service-role client). The caller has already checked full
 * access and the daily cap. On any failure the row is marked failed and the failure says why.
 */
export async function processScanPhoto(
  supabase: SupabaseClient,
  scan: { id: string; library_id: string; photo_path: string },
): Promise<ScanOutcome> {
  // Claim the row; only one run may read it.
  const { data: claimed } = await supabase
    .from("scan_jobs")
    .update({ status: "processing", error: null })
    .eq("id", scan.id)
    .eq("status", "pending")
    .select("id");
  if (!claimed || claimed.length === 0) return { ok: false, status: 409, kind: "busy", error: "That photo is already being read." };

  const fail = async (status: number, kind: string, message: string, usage?: { inputTokens: number; outputTokens: number }): Promise<ScanFailure> => {
    await supabase
      .from("scan_jobs")
      .update({ status: "failed", error: message, input_tokens: usage?.inputTokens ?? null, output_tokens: usage?.outputTokens ?? null })
      .eq("id", scan.id);
    return { ok: false, status, kind, error: message };
  };

  try {
    const { data: blob, error: dlError } = await supabase.storage.from(SCANS_BUCKET).download(scan.photo_path);
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
          const existing = await loadDuplicateCandidates(scan.library_id, { title: r.best.title, isbn13: r.best.isbn13 }, supabase);
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
      .eq("id", scan.id);
    return { ok: true, items, dropped: result.dropped };
  } catch (e) {
    if (e instanceof IdentifyError) {
      const status = e.kind === "busy" ? 429 : e.kind === "config" ? 503 : 502;
      return await fail(status, e.kind, e.message, e.usage);
    }
    console.error("[scan] unexpected failure", e instanceof Error ? e.message : e);
    return await fail(500, "failed", "Something went wrong reading that photo. Try again.");
  }
}
