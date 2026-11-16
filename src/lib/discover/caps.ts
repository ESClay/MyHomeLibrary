/** Daily refresh caps for recommendations. Pure. */
import { DAY_MS, capStatus, capWindowStart, type CapStatus } from "@/lib/scan/photo";
import type { RecommendScope } from "@/lib/ai/recommend-schema";

/** Manual refreshes per person per rolling 24 hours for "For you". */
export const PERSONAL_DAILY_CAP = 5;
/** Manual refreshes per library per rolling 24 hours for "For both of you". */
export const SHARED_DAILY_CAP = 5;

export const capFor = (scope: RecommendScope) => (scope === "personal" ? PERSONAL_DAILY_CAP : SHARED_DAILY_CAP);

export { capWindowStart };

/** Status from the number of manual generations (including failed ones that cost tokens) in the window. */
export function refreshCap(scope: RecommendScope, used: number): CapStatus {
  return capStatus(used, capFor(scope));
}

/** When the oldest counted refresh leaves the window, so the next one is allowed. */
export function nextRefreshAt(oldestInWindowIso: string | null): Date | null {
  return oldestInWindowIso ? new Date(new Date(oldestInWindowIso).getTime() + DAY_MS) : null;
}

export function capMessage(scope: RecommendScope, nextAt: Date | null, now = Date.now()): string {
  const cap = capFor(scope);
  const who = scope === "personal" ? "You have" : "This library has";
  const when = nextAt ? ` The next one opens in about ${hoursUntil(nextAt, now)}.` : "";
  return `${who} used all ${cap} refreshes for today.${when}`;
}

export function hoursUntil(at: Date, now = Date.now()): string {
  const mins = Math.max(1, Math.round((at.getTime() - now) / 60000));
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const h = Math.round(mins / 60);
  return `${h} hour${h === 1 ? "" : "s"}`;
}

/** "3 days ago", "just now". Deterministic: the clock is passed in. */
export function timeAgo(iso: string, now = Date.now()): string {
  const secs = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
