/** queuePhotoBatch: validation, role, full access and the daily cap, with Supabase mocked. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "2f6e1a52-8f33-4c1b-9b9e-0f5b3a7d1c11";
const LIB = "3a7d1c11-2f6e-4a52-8f33-9b9e0f5b3a7d";
const photo = (n: number) => `${LIB}/${USER}/7ebf5a55-6da2-4e96-8d77-3f9f7ebf5a5${n}.jpg`;

const s = vi.hoisted(() => ({
  granted: true,
  role: "editor" as string | null,
  cap: { reached: false, remaining: 5, cap: 50, used: 45 },
  inserted: [] as unknown[],
  insertError: null as { message: string } | null,
  enqueue: vi.fn(),
  tick: vi.fn(),
  adminCalls: [] as string[],
}));

vi.mock("react", async (o) => ({ ...(await o<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (o) => ({ ...(await o<typeof import("next/server")>()), after: (fn: () => unknown) => void fn() }));
vi.mock("@/lib/library", () => ({ requireUser: async () => ({ id: USER }) }));
vi.mock("@/lib/books/access", () => ({
  authorizeBook: vi.fn(),
  canEdit: (r: string | null) => r === "owner" || r === "editor",
  fail: (error: string) => ({ ok: false, error }),
  firstIssue: (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "bad",
  roleInLibrary: async () => s.role,
}));
vi.mock("@/lib/access", () => ({
  hasFullAccess: async () => s.granted,
  fullAccessDenied: () => ({ ok: false, error: "Full access needed.", code: "full_access_required" }),
}));
vi.mock("@/lib/scan/jobs", () => ({ SCANS_BUCKET: "scans", dailyScanStatus: async () => s.cap }));
vi.mock("@/lib/jobs/queue/enqueue", () => ({ enqueueJob: s.enqueue }));
vi.mock("@/lib/jobs/queue/tick", () => ({ runJobsTick: s.tick }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => ({ insert: async (rows: unknown) => (s.inserted.push(rows), { error: s.insertError }) }) }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      delete: () => ({ eq: async () => (s.adminCalls.push("delete"), {}) }),
      update: () => ({ eq: async () => (s.adminCalls.push("release"), {}) }),
    }),
  }),
}));

import { queuePhotoBatch } from "./actions";

beforeEach(() => {
  s.granted = true;
  s.role = "editor";
  s.cap = { reached: false, remaining: 5, cap: 50, used: 45 };
  s.inserted = [];
  s.insertError = null;
  s.adminCalls = [];
  s.enqueue.mockReset().mockResolvedValue({ job: { id: "job-1" }, created: true });
  s.tick.mockReset().mockResolvedValue({ jobs: [] });
});

describe("queuePhotoBatch", () => {
  it("queues one job for the batch, links each photo, releases the hold and kicks one tick", async () => {
    const res = await queuePhotoBatch({ libraryId: LIB, photoPaths: [photo(1), photo(2)] });
    expect(res).toMatchObject({ ok: true, jobId: "job-1", queued: 2, waiting: 0 });
    expect(s.enqueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ libraryId: LIB, userId: USER, kind: "photo_scan", total: 2 }));
    expect(s.enqueue.mock.calls[0][1].notBefore).toBeGreaterThan(Date.now());
    expect(s.inserted).toEqual([[{ library_id: LIB, photo_path: photo(1), job_id: "job-1" }, { library_id: LIB, photo_path: photo(2), job_id: "job-1" }]]);
    expect(s.adminCalls).toEqual(["release"]);
    expect(s.tick).toHaveBeenCalledTimes(1);
  });

  it("counts photos beyond today's allowance as waiting, and still queues them", async () => {
    s.cap = { reached: false, remaining: 1, cap: 50, used: 49 };
    expect(await queuePhotoBatch({ libraryId: LIB, photoPaths: [photo(1), photo(2), photo(3)] })).toMatchObject({ ok: true, queued: 3, waiting: 2 });
  });

  it("drops a path that appears twice", async () => {
    expect(await queuePhotoBatch({ libraryId: LIB, photoPaths: [photo(1), photo(1)] })).toMatchObject({ ok: true, queued: 1 });
  });

  it("refuses without full access and queues nothing", async () => {
    s.granted = false;
    expect(await queuePhotoBatch({ libraryId: LIB, photoPaths: [photo(1)] })).toMatchObject({ ok: false, code: "full_access_required" });
    expect(s.enqueue).not.toHaveBeenCalled();
  });

  it("refuses a viewer and a non-member", async () => {
    s.role = "viewer";
    expect(await queuePhotoBatch({ libraryId: LIB, photoPaths: [photo(1)] })).toMatchObject({ ok: false, error: expect.stringContaining("owners and editors") });
    s.role = null;
    expect(await queuePhotoBatch({ libraryId: LIB, photoPaths: [photo(1)] })).toMatchObject({ ok: false, error: expect.stringContaining("not a member") });
    expect(s.enqueue).not.toHaveBeenCalled();
  });

  it("validates the batch: empty, too big, bad library id, and photos outside the person's folder", async () => {
    expect(await queuePhotoBatch({ libraryId: LIB, photoPaths: [] })).toMatchObject({ ok: false });
    expect(await queuePhotoBatch({ libraryId: LIB, photoPaths: Array.from({ length: 13 }, (_, i) => `${LIB}/${USER}/7ebf5a55-6da2-4e96-8d77-3f9f7ebf5a${String(i).padStart(2, "0")}.jpg`) })).toMatchObject({ ok: false });
    expect(await queuePhotoBatch({ libraryId: "nope", photoPaths: [photo(1)] })).toMatchObject({ ok: false });
    expect(await queuePhotoBatch({ libraryId: LIB, photoPaths: [`${LIB}/someone-else/7ebf5a55-6da2-4e96-8d77-3f9f7ebf5a55.jpg`] })).toMatchObject({ ok: false, error: "That photo is not in your folder." });
    expect(s.enqueue).not.toHaveBeenCalled();
  });

  it("answers capReached when today's allowance is already used up", async () => {
    s.cap = { reached: true, remaining: 0, cap: 50, used: 50 };
    expect(await queuePhotoBatch({ libraryId: LIB, photoPaths: [photo(1)] })).toMatchObject({ ok: false, capReached: true });
    expect(s.enqueue).not.toHaveBeenCalled();
  });

  it("removes the held job when the photos cannot be linked", async () => {
    s.insertError = { message: "boom" };
    expect(await queuePhotoBatch({ libraryId: LIB, photoPaths: [photo(1)] })).toMatchObject({ ok: false });
    expect(s.adminCalls).toEqual(["delete"]);
    expect(s.tick).not.toHaveBeenCalled();
  });
});
