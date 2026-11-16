import { describe, expect, it } from "vitest";
import { PERSONAL_DAILY_CAP, SHARED_DAILY_CAP, capFor, capMessage, capWindowStart, hoursUntil, nextRefreshAt, refreshCap, timeAgo } from "./caps";

describe("daily refresh caps", () => {
  it("is 5 per person for personal and 5 per library for shared", () => {
    expect(PERSONAL_DAILY_CAP).toBe(5);
    expect(SHARED_DAILY_CAP).toBe(5);
    expect(capFor("personal")).toBe(5);
    expect(capFor("shared")).toBe(5);
  });

  it("counts down and stops at the cap", () => {
    expect(refreshCap("personal", 0)).toEqual({ used: 0, cap: 5, remaining: 5, reached: false });
    expect(refreshCap("personal", 4)).toMatchObject({ remaining: 1, reached: false });
    expect(refreshCap("shared", 5)).toMatchObject({ remaining: 0, reached: true });
    expect(refreshCap("shared", 9)).toMatchObject({ remaining: 0, reached: true });
  });

  it("uses a rolling 24 hour window", () => {
    const now = Date.parse("2026-11-15T12:00:00Z");
    expect(capWindowStart(now)).toBe("2026-11-14T12:00:00.000Z");
  });

  it("reopens 24 hours after the oldest counted refresh", () => {
    const next = nextRefreshAt("2026-11-14T15:00:00Z")!;
    expect(next.toISOString()).toBe("2026-11-15T15:00:00.000Z");
    expect(nextRefreshAt(null)).toBeNull();
    const now = Date.parse("2026-11-15T12:00:00Z");
    expect(hoursUntil(next, now)).toBe("3 hours");
    expect(capMessage("personal", next, now)).toBe("You have used all 5 refreshes for today. The next one opens in about 3 hours.");
    expect(capMessage("shared", null, now)).toBe("This library has used all 5 refreshes for today.");
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  it("reads naturally", () => {
    expect(timeAgo("2026-11-15T11:59:50Z", now)).toBe("just now");
    expect(timeAgo("2026-11-15T11:30:00Z", now)).toBe("30 minutes ago");
    expect(timeAgo("2026-11-15T09:00:00Z", now)).toBe("3 hours ago");
    expect(timeAgo("2026-11-12T12:00:00Z", now)).toBe("3 days ago");
    expect(timeAgo("2026-11-14T12:00:00Z", now)).toBe("1 day ago");
  });
});
