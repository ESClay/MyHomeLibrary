import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countSeriesWork, syncLibrarySeries } from "@/lib/discover/series-sync";
import { hasFullAccess } from "@/lib/access";
import { dailyReadsStatus, nextCapReset } from "@/lib/scan/jobs";
import { processScanPhoto } from "@/lib/scan/process";
import { photoScanHandler } from "./photo-scan";
import { seriesLookupHandler } from "./series-lookup";
import type { JobHandlers } from "./types";

/**
 * The registry of what the worker can run: one handler per job kind. The tick only claims kinds listed here.
 */
export function buildHandlers(admin: SupabaseClient): JobHandlers {
  return {
    series_lookup: seriesLookupHandler({
      sync: (libraryId, o) =>
        syncLibrarySeries(admin, libraryId, { budgetMs: o.budgetMs, now: o.now, onChange: o.onChange, maxBookLookups: Infinity, maxNameSearches: Infinity }),
      countWork: (libraryId) => countSeriesWork(admin, libraryId),
      countChangedBooks: async (jobId) => {
        const { count } = await admin.from("job_changes").select("id", { count: "exact", head: true }).eq("job_id", jobId);
        return count ?? 0;
      },
    }),
    photo_scan: photoScanHandler({
      hasFullAccess: (userId) => hasFullAccess(admin, userId),
      readsStatus: (userId, now) => dailyReadsStatus(admin, userId, now),
      nextCapReset: (userId, now) => nextCapReset(admin, userId, now),
      loadPhotos: async (jobId) => {
        const { data, error } = await admin.from("scan_jobs").select("id, status, updated_at").eq("job_id", jobId).is("photo_deleted_at", null).order("created_at");
        if (error) throw new Error(`scan_jobs: ${error.message}`);
        return (data ?? []).map((r) => ({ id: r.id as string, status: r.status as string, updatedAt: Date.parse(r.updated_at as string) }));
      },
      process: async (scanId) => {
        const { data } = await admin.from("scan_jobs").select("id, library_id, photo_path").eq("id", scanId).maybeSingle();
        if (!data) return { ok: false, status: 404, kind: "not_found", error: "That photo could not be found." };
        return processScanPhoto(admin, data);
      },
      requeue: async (scanId) => {
        await admin.from("scan_jobs").update({ status: "pending", error: null }).eq("id", scanId).in("status", ["processing", "failed"]);
      },
      failUnread: async (jobId, message) => {
        await admin.from("scan_jobs").update({ status: "failed", error: message }).eq("job_id", jobId).in("status", ["pending", "processing"]);
      },
    }),
  };
}
