/** Pure helpers for photo batches: path checks, which uploads to clear, and how a photo reads in the UI. No I/O. */

export const MAX_BATCH_PHOTOS = 12;

const FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

/** True when `path` is <libraryId>/<userId>/<uuid>.jpg: the one folder a person may upload scan photos to. */
export function isOwnScanPath(path: string, userId: string, libraryId?: string): boolean {
  const [lib, owner, file, ...rest] = path.split("/");
  if (!lib || owner !== userId || !file || rest.length > 0 || !FILE.test(file)) return false;
  return libraryId === undefined || lib === libraryId;
}

export type UploadState = "waiting" | "uploading" | "uploaded" | "queued" | "failed";

/**
 * The storage paths to clear when the person leaves the page: photos that are in Storage but were never queued.
 * Queued photos belong to the background job and are kept; so are ones still waiting to upload (nothing is in Storage).
 */
export function unfinishedUploads(items: { path: string | null; state: UploadState }[]): string[] {
  return items.filter((i) => i.path && (i.state === "uploaded" || i.state === "uploading")).map((i) => i.path as string);
}

export type PhotoRowState = "ready" | "saved" | "cleared" | "reading" | "waiting_cap" | "queued" | "stopped" | "failed";

export const PHOTO_STATE_LABEL: Record<PhotoRowState, string> = {
  ready: "Ready to review",
  saved: "Saved",
  cleared: "Cleared",
  reading: "Reading the books",
  waiting_cap: "Waiting for tomorrow's allowance",
  queued: "Waiting its turn",
  stopped: "Not read",
  failed: "Could not read",
};

/** How one photo of a batch reads, from its own row and its batch's state. */
export function photoRowState(
  scan: { status: string; photo_deleted_at: string | null },
  batch: { status: string; capWait: boolean },
): PhotoRowState {
  if (scan.status === "saved") return "saved";
  if (scan.status === "ready") return scan.photo_deleted_at ? "cleared" : "ready";
  if (scan.status === "failed") return "failed";
  if (scan.status === "processing") return batch.status === "running" || batch.status === "queued" ? "reading" : "stopped";
  if (batch.status === "queued" || batch.status === "running") return batch.capWait ? "waiting_cap" : "queued";
  return "stopped";
}
