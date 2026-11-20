/** The daily job spends Claude, Hardcover and eBay quota only on people and libraries that have full access. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/supabase-fake";

const spies = vi.hoisted(() => ({
  generateSet: vi.fn(),
  countSeriesWork: vi.fn(),
  enqueueJob: vi.fn(),
  price: vi.fn(),
  requestPicks: vi.fn(),
}));

class Denied extends Error {}
vi.mock("@/lib/discover/recs", () => ({
  generateSet: spies.generateSet,
  AccessDenied: Denied,
  CapReached: class extends Error {},
  NotEnoughSignal: class extends Error {},
}));
vi.mock("@/lib/discover/series-sync", () => ({ countSeriesWork: spies.countSeriesWork }));
vi.mock("./queue/enqueue", () => ({ enqueueJob: spies.enqueueJob }));
vi.mock("@/lib/ai/recommend", () => ({ RecommendError: class extends Error {} }));
vi.mock("@/lib/pricing/ebay", () => ({ getEbayClient: () => ({ price: spies.price }) }));
vi.mock("./scan-cleanup", () => ({ cleanupScanBatch: vi.fn() }));
vi.mock("@/lib/pricing/record", () => ({ recordPrice: vi.fn(), recordNoPrice: vi.fn() }));

const ctx = { deadline: Date.now() + 10 * 60_000, cursor: null, now: () => Date.now() };

beforeEach(() => vi.clearAllMocks());

describe("series sync task", () => {
  const tables = () => ({
    libraries: [{ id: "L1" }, { id: "L2" }, { id: "L3" }],
    library_members: [
      { library_id: "L1", user_id: "alice" },
      { library_id: "L2", user_id: "bob" },
      { library_id: "L3", user_id: "carol" },
      { library_id: "L3", user_id: "dave" },
    ],
    user_entitlements: [
      { user_id: "alice", full_access: true },
      { user_id: "bob", full_access: false },
      { user_id: "dave", full_access: true },
    ],
  });

  it("queues a series lookup only for libraries with a granted member and work waiting", async () => {
    spies.countSeriesWork.mockImplementation(async (_admin: unknown, id: string) => (id === "L3" ? 0 : 5));
    spies.enqueueJob.mockResolvedValue({ job: {}, created: true });
    const { seriesSyncTask } = await import("./tasks");
    const out = await seriesSyncTask(fakeSupabase(tables()) as never)(ctx);
    expect(out.status).toBe("complete");
    expect(spies.enqueueJob.mock.calls.map((c) => c[1])).toEqual([{ libraryId: "L1", userId: null, kind: "series_lookup" }]);
  });

  it("does nothing, and reads no libraries, when nobody has full access", async () => {
    const { seriesSyncTask } = await import("./tasks");
    const fake = fakeSupabase({ ...tables(), user_entitlements: [] });
    const out = await seriesSyncTask(fake as never)(ctx);
    expect(out.status).toBe("complete");
    expect(spies.enqueueJob).not.toHaveBeenCalled();
    expect(fake.calls.some((c) => c.table === "libraries")).toBe(false);
  });
});

describe("recommendations task", () => {
  const tables = (granted: string[]) => ({
    user_books: [{ user_id: "alice" }, { user_id: "carol" }],
    books: [],
    recommendation_sets: [],
    library_members: [
      { library_id: "L1", user_id: "alice" },
      { library_id: "L1", user_id: "bob" },
      { library_id: "L2", user_id: "carol" },
      { library_id: "L2", user_id: "dave" },
    ],
    user_entitlements: granted.map((user_id) => ({ user_id, full_access: true })),
  });

  it("generates personal sets for granted people and shared sets for libraries with a granted member", async () => {
    spies.generateSet.mockResolvedValue({ count: 1, usage: { inputTokens: 1, outputTokens: 1 } });
    const { recommendationsTask } = await import("./tasks");
    // Alice and Carol are active. Alice and Dave are granted: Carol (active, ungranted) gets no personal set,
    // but her library has a granted member (Dave), so it still gets a shared one.
    await recommendationsTask(fakeSupabase(tables(["alice", "dave"])) as never)(ctx);
    const made = spies.generateSet.mock.calls.map((c) => `${c[0].scope}:${c[0].libraryId}:${c[0].userId ?? "-"}`).sort();
    expect(made).toEqual(["personal:L1:alice", "shared:L1:-", "shared:L2:-"]);
  });

  it("generates nothing when nobody has full access", async () => {
    const { recommendationsTask } = await import("./tasks");
    const out = await recommendationsTask(fakeSupabase(tables([])) as never)(ctx);
    expect(out.status).toBe("complete");
    expect(spies.generateSet).not.toHaveBeenCalled();
  });
});

describe("price refresh task", () => {
  it("does not call eBay or read candidates when nobody has full access", async () => {
    const { priceRefreshTask } = await import("./tasks");
    const fake = fakeSupabase({ user_entitlements: [] });
    const out = await priceRefreshTask(fake as never)(ctx);
    expect(out.status).toBe("complete");
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(spies.price).not.toHaveBeenCalled();
  });

  it("asks the database for candidates once someone has access (the query itself keeps to granted libraries)", async () => {
    const { priceRefreshTask } = await import("./tasks");
    const fake = fakeSupabase({ user_entitlements: [{ user_id: "alice", full_access: true }] }, () => []);
    const out = await priceRefreshTask(fake as never)(ctx);
    expect(out.status).toBe("complete");
    expect(fake.rpc).toHaveBeenCalledWith("price_refresh_candidates", expect.any(Object));
  });
});
