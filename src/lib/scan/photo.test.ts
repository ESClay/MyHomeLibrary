import { describe, expect, it, vi } from "vitest";
import { isAuthorizedCron } from "@/lib/cron";
import { dailyScanStatus, deleteScanPhoto } from "./jobs";
import { DAILY_SCAN_CAP, DAY_MS, capMessage, capStatus, capWindowStart, confidenceBand, sniffImageType } from "./photo";

describe("daily cap", () => {
  it("counts down to zero and then reports reached", () => {
    expect(capStatus(0)).toEqual({ used: 0, cap: DAILY_SCAN_CAP, remaining: DAILY_SCAN_CAP, reached: false });
    expect(capStatus(DAILY_SCAN_CAP - 1)).toMatchObject({ remaining: 1, reached: false });
    expect(capStatus(DAILY_SCAN_CAP)).toMatchObject({ remaining: 0, reached: true });
    expect(capStatus(DAILY_SCAN_CAP + 7)).toMatchObject({ remaining: 0, reached: true });
  });
  it("is defensive about odd counts", () => {
    expect(capStatus(-3).used).toBe(0);
    expect(capStatus(2.9).used).toBe(2);
  });
  it("says what happened and when it resets", () => {
    expect(capMessage(50)).toMatch(/all 50 photo reads/);
    expect(capMessage(50)).toMatch(/24 hours/);
  });
  it("counts a rolling 24 hours", () => {
    const now = Date.UTC(2026, 10, 16, 12);
    expect(capWindowStart(now)).toBe(new Date(now - DAY_MS).toISOString());
  });

  // dailyScanStatus asks the database for the count; a stand-in answers.
  function fakeSupabase(count: number | null) {
    const calls: Record<string, unknown[]> = {};
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "or"]) {
      chain[m] = (...args: unknown[]) => {
        calls[m] = args;
        return m === "or" ? Promise.resolve({ count }) : chain;
      };
    }
    return { client: { from: () => chain } as never, calls };
  }

  it("counts this user's recent jobs, leaving out ones that failed before costing anything", async () => {
    const now = Date.UTC(2026, 10, 16, 12);
    const { client, calls } = fakeSupabase(12);
    const s = await dailyScanStatus(client, "user-1", now);
    expect(s).toMatchObject({ used: 12, remaining: DAILY_SCAN_CAP - 12, reached: false });
    expect(calls.eq).toEqual(["user_id", "user-1"]);
    expect(calls.gte).toEqual(["created_at", capWindowStart(now)]);
    expect(calls.or).toEqual(["status.neq.failed,input_tokens.not.is.null"]);
  });
  it("reaches the cap at 50", async () => {
    expect((await dailyScanStatus(fakeSupabase(50).client, "u")).reached).toBe(true);
  });
  it("treats a missing count as none", async () => {
    expect((await dailyScanStatus(fakeSupabase(null).client, "u")).used).toBe(0);
  });
});

describe("photo retention", () => {
  const supa = (removeError: unknown) => {
    const remove = vi.fn().mockResolvedValue({ error: removeError });
    const eq = vi.fn().mockResolvedValue({});
    const update = vi.fn().mockReturnValue({ eq });
    return { client: { storage: { from: vi.fn().mockReturnValue({ remove }) }, from: vi.fn().mockReturnValue({ update }) } as never, remove, update, eq };
  };
  it("deletes through the Storage API and stamps the job", async () => {
    const s = supa(null);
    const ok = await deleteScanPhoto(s.client, { id: "j1", photo_path: "lib/user/x.jpg" }, "saved");
    expect(ok).toBe(true);
    expect(s.remove).toHaveBeenCalledWith(["lib/user/x.jpg"]);
    expect(s.update).toHaveBeenCalledWith(expect.objectContaining({ status: "saved", photo_deleted_at: expect.any(String) }));
    expect(s.eq).toHaveBeenCalledWith("id", "j1");
  });
  it("leaves the job alone when the delete failed, so the sweep retries it", async () => {
    const s = supa({ message: "boom" });
    expect(await deleteScanPhoto(s.client, { id: "j1", photo_path: "p" })).toBe(false);
    expect(s.update).not.toHaveBeenCalled();
  });
});

describe("image sniffing", () => {
  it("recognises JPEG, PNG and WebP by their first bytes", () => {
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImageType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
  });
  it("refuses everything else, HEIC and empty files included", () => {
    expect(sniffImageType(new Uint8Array())).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("<html>"))).toBeNull();
    expect(sniffImageType(Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]))).toBeNull();
  });
});

describe("confidence bands", () => {
  it("splits at 0.8 and 0.5", () => {
    expect(confidenceBand(1)).toBe("clear");
    expect(confidenceBand(0.8)).toBe("clear");
    expect(confidenceBand(0.79)).toBe("probable");
    expect(confidenceBand(0.5)).toBe("probable");
    expect(confidenceBand(0.49)).toBe("unsure");
  });
});

describe("cron authorization", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorizedCron("Bearer s3cret", "s3cret")).toBe(true);
    expect(isAuthorizedCron("Bearer wrong!", "s3cret")).toBe(false);
    expect(isAuthorizedCron("s3cret", "s3cret")).toBe(false);
    expect(isAuthorizedCron(null, "s3cret")).toBe(false);
  });
  it("never authorizes when no secret is configured", () => {
    expect(isAuthorizedCron("Bearer ", "")).toBe(false);
    expect(isAuthorizedCron("Bearer undefined", undefined)).toBe(false);
  });
});
