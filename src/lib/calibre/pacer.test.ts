import { describe, expect, it } from "vitest";
import { BATCH_BUDGET_MS, BATCH_SIZE, LOOKUP_GAP_MS } from "./limits";
import { createPacer } from "./pacer";

function clock() {
  let t = 1_000_000;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("createPacer", () => {
  it("spaces slots by the gap and tells when the budget is spent", async () => {
    const c = clock();
    const pacer = createPacer({ gapMs: 1000, budgetMs: 3500, now: c.now, sleep: c.sleep });
    const t0 = c.now();
    const taken: number[] = [];
    for (let i = 0; i < 6; i++) {
      if (await pacer.take()) taken.push(c.now() - t0);
    }
    expect(taken).toEqual([0, 1000, 2000, 3000]);
  });

  it("carries spacing across batches through shared state", async () => {
    const c = clock();
    const state = { last: 0 };
    await createPacer({ gapMs: 1000, budgetMs: 10_000, now: c.now, sleep: c.sleep, state }).take();
    c.advance(300);
    const before = c.now();
    await createPacer({ gapMs: 1000, budgetMs: 10_000, now: c.now, sleep: c.sleep, state }).take();
    expect(c.now() - before).toBe(700);
  });

  it("the real numbers: a full batch of ISBN-only lookups fits the budget and stays under 60 a minute", async () => {
    const c = clock();
    const pacer = createPacer({ gapMs: LOOKUP_GAP_MS, budgetMs: BATCH_BUDGET_MS, now: c.now, sleep: c.sleep });
    let slots = 0;
    for (let i = 0; i < BATCH_SIZE * 2; i++) if (await pacer.take()) slots++;
    expect(slots).toBeGreaterThanOrEqual(BATCH_SIZE);
    expect(60_000 / LOOKUP_GAP_MS).toBeLessThanOrEqual(60);
    expect(BATCH_BUDGET_MS).toBeLessThan(30_000);
  });
});
