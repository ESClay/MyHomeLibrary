import { describe, expect, it, vi } from "vitest";
import { TASKS, planTasks } from "@/lib/jobs/schedule";
import { EbayError, type PriceResult } from "./ebay";
import { CALL_BUDGET, STALE_AFTER_MS, runPriceRefresh, type Candidate, type RefreshDeps } from "./refresh";

const NOW = Date.parse("2026-11-20T04:30:00Z");

const cand = (n: number, over: Partial<Candidate> = {}): Candidate => ({ copyId: `c${n}`, format: "paperback", condition: "good", isbn: "9780441172719", priceRegion: "EBAY_CA", ...over });
const priced = (calls = 1): PriceResult => ({ status: "priced", price: 10, currency: "CAD", approximate: false, listingCount: 4, calls });

/** A queue the fake database serves from, stalest first; recorded copies leave it (they are no longer stale). */
function harness(rows: Candidate[], price: RefreshDeps["price"] = async () => priced()) {
  const queue = [...rows];
  const log = { priced: [] as string[], none: [] as string[], cutoffs: [] as string[] };
  let t = NOW;
  const deps: RefreshDeps = {
    fetchCandidates: async (cutoff, limit) => {
      log.cutoffs.push(cutoff);
      return queue.slice(0, limit);
    },
    price: vi.fn(price),
    recordPriced: async (c) => {
      log.priced.push(c.copyId);
      queue.splice(queue.findIndex((q) => q.copyId === c.copyId), 1);
    },
    recordNoPrice: async (c) => {
      log.none.push(c.copyId);
      queue.splice(queue.findIndex((q) => q.copyId === c.copyId), 1);
    },
    now: () => t,
  };
  return { deps, log, advance: (ms: number) => (t += ms) };
}

describe("price refresh scheduling", () => {
  it("is a daily task that needs the eBay keys, and is skipped cleanly without them", () => {
    expect(TASKS["price-refresh"].requiredEnv).toEqual(["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"]);
    const without = planTasks({ now: NOW, records: {}, env: { HARDCOVER_API_TOKEN: "x", ANTHROPIC_API_KEY: "y" } });
    expect(without.due).not.toContain("price-refresh");
    expect(without.skipped).toContainEqual({ task: "price-refresh", reason: "env-missing", missing: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"] });
    const withKeys = planTasks({ now: NOW, records: {}, env: { EBAY_CLIENT_ID: "a", EBAY_CLIENT_SECRET: "b" } });
    expect(withKeys.due).toContain("price-refresh");
  });

  it("runs at most once a day, but retries a partial run the next day", () => {
    const env = { EBAY_CLIENT_ID: "a", EBAY_CLIENT_SECRET: "b" };
    const hr = 3_600_000;
    const done = { lastRunAt: new Date(NOW - 3 * hr).toISOString(), lastCompletedAt: new Date(NOW - 3 * hr).toISOString(), lastStatus: "complete" as const, cursor: null };
    expect(planTasks({ now: NOW, records: { "price-refresh": done }, env }).due).not.toContain("price-refresh");
    const old = { ...done, lastRunAt: new Date(NOW - 21 * hr).toISOString(), lastCompletedAt: new Date(NOW - 21 * hr).toISOString() };
    expect(planTasks({ now: NOW, records: { "price-refresh": old }, env }).due).toContain("price-refresh");
  });
});

describe("runPriceRefresh", () => {
  it("looks for copies not checked in the last 7 days", async () => {
    const h = harness([]);
    await runPriceRefresh(h.deps, { deadline: NOW + 60_000, cursor: null });
    expect(Date.parse(h.log.cutoffs[0])).toBe(NOW - STALE_AFTER_MS);
  });

  it("prices every due copy, records it, and completes when none are left", async () => {
    const h = harness([cand(1), cand(2), cand(3)]);
    const out = await runPriceRefresh(h.deps, { deadline: NOW + 60_000, cursor: null });
    expect(out.status).toBe("complete");
    expect(h.log.priced).toEqual(["c1", "c2", "c3"]);
    expect(out.detail).toMatchObject({ checked: 3, priced: 3, calls: 3 });
  });

  it("passes the copy's own isbn, condition, format and the library's marketplace", async () => {
    const h = harness([cand(1, { priceRegion: "EBAY_GB", condition: "new", format: "hardcover", isbn: "9781234567897" })]);
    await runPriceRefresh(h.deps, { deadline: NOW + 60_000, cursor: null });
    expect(h.deps.price).toHaveBeenCalledWith({ isbn: "9781234567897", format: "hardcover", condition: "new", marketplace: "EBAY_GB" });
  });

  it("stops at the call budget, keeping a cursor so the next run continues", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => cand(i + 1));
    const h = harness(rows, async () => priced(2));
    const out = await runPriceRefresh(h.deps, { deadline: NOW + 600_000, cursor: null, callBudget: 20 });
    expect(out.status).toBe("partial");
    expect(out.detail).toMatchObject({ calls: 20, reason: "call budget used" });
    expect(h.log.priced).toHaveLength(10);
    expect(out.cursor).toEqual({ cutoff: new Date(NOW - STALE_AFTER_MS).toISOString() });
  });

  it("never plans more calls than the budget even when every check might use two", async () => {
    const h = harness(Array.from({ length: 30 }, (_, i) => cand(i + 1)), async () => priced(2));
    await runPriceRefresh(h.deps, { deadline: NOW + 600_000, cursor: null, callBudget: 7 });
    expect(h.log.priced.length * 2).toBeLessThanOrEqual(7);
  });

  it("resumes with the staleness cutoff saved by the previous run", async () => {
    const h = harness([]);
    await runPriceRefresh(h.deps, { deadline: NOW + 60_000, cursor: { cutoff: "2026-11-10T00:00:00.000Z" } });
    expect(h.log.cutoffs[0]).toBe("2026-11-10T00:00:00.000Z");
  });

  it("stops before the deadline", async () => {
    const h = harness(Array.from({ length: 20 }, (_, i) => cand(i + 1)), async () => {
      h.advance(10_000);
      return priced();
    });
    const out = await runPriceRefresh(h.deps, { deadline: NOW + 25_000, cursor: null, concurrency: 1 });
    expect(out.status).toBe("partial");
    expect(out.detail).toMatchObject({ reason: "out of time" });
    expect(h.log.priced.length).toBeGreaterThan(0);
    expect(h.log.priced.length).toBeLessThan(20);
  });

  it("marks a no-result copy as checked so it does not head the queue again", async () => {
    const h = harness([cand(1, { condition: "like_new" }), cand(2)], async (r) => {
      if (r.condition === "like_new") throw new EbayError("no_result", "none");
      return priced();
    });
    const out = await runPriceRefresh(h.deps, { deadline: NOW + 60_000, cursor: null });
    expect(h.log.none).toEqual(["c1"]);
    expect(h.log.priced).toEqual(["c2"]);
    expect(out.status).toBe("complete");
    expect(out.detail).toMatchObject({ noPrice: 1, priced: 1 });
  });

  it("marks a not-priceable copy checked too", async () => {
    const h = harness([cand(1)], async () => ({ status: "not_priced", reason: "isbn", calls: 0 }));
    const out = await runPriceRefresh(h.deps, { deadline: NOW + 60_000, cursor: null });
    expect(h.log.none).toEqual(["c1"]);
    expect(out.status).toBe("complete");
  });

  it("stops on a rate limit and reports a partial run", async () => {
    const h = harness([cand(1), cand(2), cand(3)], async () => {
      throw new EbayError("rate_limited", "slow down", 429);
    });
    const out = await runPriceRefresh(h.deps, { deadline: NOW + 60_000, cursor: null });
    expect(out.status).toBe("partial");
    expect(out.detail).toMatchObject({ reason: "eBay rate limit reached" });
  });

  it("skips a copy that keeps failing instead of looping on it", async () => {
    const h = harness([cand(1, { condition: "new" }), cand(2)], async (r) => {
      if (r.condition === "new") throw new EbayError("http", "boom", 500);
      return priced();
    });
    const out = await runPriceRefresh(h.deps, { deadline: NOW + 60_000, cursor: null });
    expect(out.status).toBe("complete");
    expect(out.detail).toMatchObject({ errors: 1, priced: 1 });
    expect(h.log.priced).toEqual(["c2"]);
  });

  it("fails the run when the keys are wrong", async () => {
    const h = harness([cand(1)], async () => {
      throw new EbayError("auth", "bad keys", 401);
    });
    await expect(runPriceRefresh(h.deps, { deadline: NOW + 60_000, cursor: null })).rejects.toMatchObject({ kind: "auth" });
  });

  it("keeps the per-run call budget well under eBay's daily allowance", () => {
    expect(CALL_BUDGET).toBeLessThanOrEqual(500);
  });
});
