/** Batching and throttling numbers for the Calibre import, in one place so the client, server and tests agree. */

/** Rows the client sends to the server action at a time. */
export const BATCH_SIZE = 10;
/**
 * Minimum gap between two catalogue lookups. Hardcover allows about 60 requests a minute and a lookup makes at most one
 * Hardcover request, so one lookup per 1.1 s stays near 54 a minute.
 */
export const LOOKUP_GAP_MS = 1100;
/**
 * A batch stops looking things up after this long and saves the remaining rows without enrichment, so one action call
 * (10 rows, at most two lookups each, paced) stays far under the function time limit.
 */
export const BATCH_BUDGET_MS = 25_000;
/** `maxDuration` of the import page, in seconds (it must be written as a literal in page.tsx). The budget above leaves a wide margin below it. */
export const PAGE_MAX_DURATION_S = 60;
/** After a rate-limit answer the client waits this long before the next batch. */
export const RATE_LIMIT_PAUSE_MS = 30_000;
/** Rows per request when the reviewed rows are uploaded into the job (a request body is capped at 1 MB). */
export const UPLOAD_CHUNK = 100;
/** Rows per request when a reloaded import fetches its remaining rows. */
export const RESUME_FETCH = 200;
/** Descriptions are cut to this length in the stored job rows, to keep the job small. */
export const JOB_DESCRIPTION_MAX = 3000;
/** Per-row errors kept on the job. The rest are only counted. */
export const MAX_STORED_ERRORS = 200;
/** Most rows one catalog may hold. */
export const MAX_ROWS = 20_000;
/** Largest file accepted, in bytes. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Rough seconds per row, used for the estimate before and during an import. */
export const SECONDS_PER_ENRICHED_ROW = LOOKUP_GAP_MS / 1000 + 0.3;
export const SECONDS_PER_PLAIN_ROW = 0.15;
