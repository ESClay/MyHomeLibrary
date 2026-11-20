import { describe, expect, it, vi } from "vitest";
import { BUSY_WAIT_MS, MIN_PHOTO_MS, photoScanHandler, STALE_PROCESSING_MS, type PhotoRow, type PhotoScanDeps } from "./photo-scan";
import type { Job, SliceContext } from "./types";

const NOW = 1_000_000_000;
const job = (over: Partial<Job> = {}): Job => ({
  id: "j1", libraryId: "L1", userId: "u1", kind: "photo_scan", status: "running", total: 3, processed: 0, cursor: null, summary: {}, error: null,
  notBefore: null, lockedUntil: null, lockedBy: "r", createdAt: "", startedAt: null, finishedAt: null, seenAt: null, ...over,
});
const ctx = (j: Job, over: Partial<SliceContext> = {}): SliceContext => ({ job: j, deadline: NOW + 45_000, tickDeadline: NOW + 240_000, now: () => NOW, recordChanges: async () => undefined, ...over });
const photo = (id: string, status: string, updatedAt = NOW): PhotoRow => ({ id, status, updatedAt });

/** In-memory photos; process() flips the photo to ready. */
function deps(rows: PhotoRow[], over: Partial<PhotoScanDeps> = {}) {
  const d = {
    hasFullAccess: vi.fn(async () => true),
    readsStatus: vi.fn(async () => ({ used: 3, cap: 50, remaining: 47, reached: false })),
    nextCapReset: vi.fn(async () => NOW + 3_600_000),
    loadPhotos: vi.fn(async () => rows.map((r) => ({ ...r }))),
    process: vi.fn(async (id: string) => {
      rows.find((r) => r.id === id)!.status = "ready";
      return { ok: true as const, items: [], dropped: 0 };
    }),
    requeue: vi.fn(async (id: string) => void (rows.find((r) => r.id === id)!.status = "pending")),
    failUnread: vi.fn(async () => undefined),
    ...over,
  } satisfies PhotoScanDeps;
  return d;
}

describe("photo_scan handler", () => {
  it("reads exactly one photo per slice and carries on", async () => {
    const rows = [photo("a", "pending"), photo("b", "pending"), photo("c", "pending")];
    const d = deps(rows);
    const out = await photoScanHandler(d)(ctx(job()));
    expect(d.process).toHaveBeenCalledTimes(1);
    expect(d.process).toHaveBeenCalledWith("a");
    expect(out).toMatchObject({ state: "continue", total: 3, processed: 1, summary: { ready: 1, failed: 0, capWait: false } });
  });

  it("finishes after the last photo, counting ready and failed", async () => {
    const rows = [photo("a", "ready"), photo("b", "failed"), photo("c", "pending")];
    const out = await photoScanHandler(deps(rows))(ctx(job()));
    expect(out).toMatchObject({ state: "done", total: 3, processed: 3, summary: { ready: 2, failed: 1 } });
  });

  it("is done at once when every photo is already read", async () => {
    const d = deps([photo("a", "ready")]);
    const out = await photoScanHandler(d)(ctx(job()));
    expect(d.process).not.toHaveBeenCalled();
    expect(out.state).toBe("done");
  });

  it("over the daily cap, reads nothing and waits until the oldest read leaves the window", async () => {
    const rows = [photo("a", "pending")];
    const d = deps(rows, { readsStatus: vi.fn(async () => ({ used: 50, cap: 50, remaining: 0, reached: true })), nextCapReset: vi.fn(async () => NOW + 7_200_000) });
    const out = await photoScanHandler(d)(ctx(job()));
    expect(d.process).not.toHaveBeenCalled();
    expect(out).toMatchObject({ state: "wait", notBefore: NOW + 7_200_000, total: 1, summary: { capWait: true } });
  });

  it("checks the cap again for every photo", async () => {
    const rows = [photo("a", "pending"), photo("b", "pending")];
    const d = deps(rows);
    const h = photoScanHandler(d);
    await h(ctx(job()));
    await h(ctx(job()));
    expect(d.readsStatus).toHaveBeenCalledTimes(2);
  });

  it("refuses without full access: nothing is read, unread photos are failed, the job fails", async () => {
    const rows = [photo("a", "pending")];
    const d = deps(rows, { hasFullAccess: vi.fn(async () => false) });
    const out = await photoScanHandler(d)(ctx(job()));
    expect(d.hasFullAccess).toHaveBeenCalledWith("u1");
    expect(d.process).not.toHaveBeenCalled();
    expect(d.readsStatus).not.toHaveBeenCalled();
    expect(d.failUnread).toHaveBeenCalledWith("j1", expect.stringContaining("Full access"));
    expect(out).toMatchObject({ state: "failed", error: expect.stringContaining("Full access") });
  });

  it("releases the job when too little of the tick is left for a whole photo read", async () => {
    const rows = [photo("a", "pending")];
    const d = deps(rows);
    const out = await photoScanHandler(d)(ctx(job(), { tickDeadline: NOW + MIN_PHOTO_MS - 1 }));
    expect(d.process).not.toHaveBeenCalled();
    expect(d.readsStatus).not.toHaveBeenCalled();
    expect(out).toMatchObject({ state: "wait", notBefore: NOW + 1_000 });
  });

  it("starts a photo when exactly enough of the tick is left", async () => {
    const d = deps([photo("a", "pending")]);
    await photoScanHandler(d)(ctx(job(), { tickDeadline: NOW + MIN_PHOTO_MS }));
    expect(d.process).toHaveBeenCalledTimes(1);
  });

  it("reads a photo again when its run died mid-read", async () => {
    const rows = [photo("a", "processing", NOW - STALE_PROCESSING_MS - 1)];
    const d = deps(rows);
    await photoScanHandler(d)(ctx(job()));
    expect(d.requeue).toHaveBeenCalledWith("a");
    expect(d.process).toHaveBeenCalledWith("a");
  });

  it("leaves a photo another run is still reading, and waits a little", async () => {
    const d = deps([photo("a", "processing", NOW - 10_000)]);
    const out = await photoScanHandler(d)(ctx(job()));
    expect(d.process).not.toHaveBeenCalled();
    expect(out).toMatchObject({ state: "wait", notBefore: NOW + 15_000 });
  });

  it("puts a rate-limited photo back and waits a minute", async () => {
    const rows = [photo("a", "pending")];
    const d = deps(rows, { process: vi.fn(async () => ({ ok: false as const, status: 429, kind: "busy", error: "busy" })) });
    const out = await photoScanHandler(d)(ctx(job()));
    expect(d.requeue).toHaveBeenCalledWith("a");
    expect(out).toMatchObject({ state: "wait", notBefore: NOW + BUSY_WAIT_MS, cursor: { busyWaits: 1 } });
  });

  it("carries on past a photo that failed to read", async () => {
    const rows = [photo("a", "pending"), photo("b", "pending")];
    const d = deps(rows, {
      process: vi.fn(async (id: string) => {
        rows.find((r) => r.id === id)!.status = "failed";
        return { ok: false as const, status: 415, kind: "bad_image", error: "bad" };
      }),
    });
    const out = await photoScanHandler(d)(ctx(job()));
    expect(out).toMatchObject({ state: "continue", processed: 1, summary: { failed: 1 } });
  });
});
