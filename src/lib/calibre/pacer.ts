/** Spaces catalogue lookups apart and stops handing out slots when the batch's time budget is spent. Clock is injected. */

export type PacerState = { last: number };

export type Pacer = {
  /** Waits for the next free slot. False means the budget would run out first: skip the lookup. */
  take(): Promise<boolean>;
};

export function createPacer(opts: {
  gapMs: number;
  budgetMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Shared between batches handled by the same server instance, so spacing carries over. */
  state?: PacerState;
}): Pacer {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const state = opts.state ?? { last: 0 };
  const startedAt = now();
  return {
    async take() {
      const wait = Math.max(0, state.last + opts.gapMs - now());
      if (now() + wait - startedAt > opts.budgetMs) return false;
      if (wait > 0) await sleep(wait);
      state.last = now();
      return true;
    },
  };
}
