/** Limits and checks for scan photos. Pure; shared by the client (downscale) and the server (caps). */

/** Longest side the browser downscales to before upload. */
export const PHOTO_MAX_SIDE = 2000;
/** Largest image the server will send to the model. The API accepts 5 MB, base64 inflates by a third. */
export const MAX_MODEL_IMAGE_BYTES = 3.5 * 1024 * 1024;
/** Hard ceiling on what the server will even download from storage (the bucket itself allows 10 MB). */
export const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;

export type ModelImageType = "image/jpeg" | "image/png" | "image/webp";

/** The real type from the file's first bytes (never trust a name or header). null for anything else, HEIC included. */
export function sniffImageType(b: Uint8Array): ModelImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return "image/webp";
  }
  return null;
}

// ---------------------------------------------------------------- daily cap

/** Photo reads each person may start in a rolling 24 hours. */
export const DAILY_SCAN_CAP = 50;
export const DAY_MS = 24 * 60 * 60 * 1000;

export type CapStatus = { used: number; cap: number; remaining: number; reached: boolean };

export function capStatus(used: number, cap = DAILY_SCAN_CAP): CapStatus {
  const u = Math.max(0, Math.floor(used));
  return { used: u, cap, remaining: Math.max(0, cap - u), reached: u >= cap };
}

export const capMessage = (cap = DAILY_SCAN_CAP) =>
  `You have used all ${cap} photo reads for today. The count resets 24 hours after each read, or you can add books by barcode or search in the meantime.`;

/** The earliest created_at that still counts toward today's cap. */
export const capWindowStart = (now: number) => new Date(now - DAY_MS).toISOString();

// ---------------------------------------------------------------- confidence

export type ConfidenceBand = "clear" | "probable" | "unsure";
export const CONFIDENCE_LABEL: Record<ConfidenceBand, string> = {
  clear: "Read clearly",
  probable: "Probably right",
  unsure: "Not sure",
};

export function confidenceBand(c: number): ConfidenceBand {
  if (c >= 0.8) return "clear";
  if (c >= 0.5) return "probable";
  return "unsure";
}
