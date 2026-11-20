import type { SupabaseClient } from "@supabase/supabase-js";
import { loadJob } from "@/lib/jobs/queue/queries";
import type { Job } from "@/lib/jobs/queue/types";
import { photoRowState, type PhotoRowState } from "./batch";
import type { ScanItem } from "./resolve";

export type BatchPhoto = {
  id: string;
  /** 1-based position in the batch, for "Photo 2". */
  number: number;
  state: PhotoRowState;
  error: string | null;
  items: ScanItem[];
};

export type PhotoBatch = { job: Job; photos: BatchPhoto[]; capWait: boolean };

/**
 * One photo batch of a library: its job and each photo's state and result, read with the person's own client (they
 * only see their own scan rows). Returns null when the tables are not there yet or the batch is not theirs to see.
 */
export async function loadPhotoBatch(supabase: SupabaseClient, libraryId: string, jobId: string): Promise<PhotoBatch | null> {
  try {
    const job = await loadJob(supabase, libraryId, jobId);
    if (!job || job.kind !== "photo_scan") return null;
    const { data, error } = await supabase
      .from("scan_jobs")
      .select("id, status, detected, error, photo_deleted_at")
      .eq("job_id", jobId)
      .order("created_at")
      .order("id");
    if (error || !data) return null;
    const capWait = job.summary.capWait === true;
    return {
      job,
      capWait,
      photos: data.map((r, i) => {
        const state = photoRowState(r as { status: string; photo_deleted_at: string | null }, { status: job.status, capWait });
        return {
          id: r.id as string,
          number: i + 1,
          state,
          error: (r.error as string | null) ?? null,
          items: state === "ready" ? ((r.detected as ScanItem[] | null) ?? []) : [],
        };
      }),
    };
  } catch {
    return null;
  }
}
