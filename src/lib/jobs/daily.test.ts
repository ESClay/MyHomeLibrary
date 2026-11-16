import { describe, expect, it, vi } from "vitest";
import { runDaily, type RunStore, type TaskRunner } from "./daily";
import { TASKS, isDue, planTasks, type RunRecord, type TaskId } from "./schedule";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-11-15T04:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const rec = (over: Partial<RunRecord>): RunRecord => ({ lastRunAt: null, lastCompletedAt: null, lastStatus: null, cursor: null, ...over });
const ENV = { HARDCOVER_API_TOKEN: "x", ANTHROPIC_API_KEY: "y" };

describe("planTasks", () => {
  it("runs everything on the first run", () => {
    expect(planTasks({ now: NOW, records: {}, env: ENV }).due).toEqual(["scan-cleanup", "series-sync", "recommendations"]);
  });

  it("runs the cleanup daily but the weekly tasks only after about a week", () => {
    const records = {
      "scan-cleanup": rec({ lastRunAt: iso(NOW - 24 * HOUR), lastCompletedAt: iso(NOW - 24 * HOUR), lastStatus: "complete" as const }),
      "series-sync": rec({ lastRunAt: iso(NOW - 2 * DAY), lastCompletedAt: iso(NOW - 2 * DAY), lastStatus: "complete" as const }),
      recommendations: rec({ lastRunAt: iso(NOW - 7 * DAY), lastCompletedAt: iso(NOW - 7 * DAY), lastStatus: "complete" as const }),
    };
    const plan = planTasks({ now: NOW, records, env: ENV });
    expect(plan.due).toEqual(["scan-cleanup", "recommendations"]);
    expect(plan.skipped).toEqual([
      { task: "series-sync", reason: "not-due" },
      { task: "price-refresh", reason: "env-missing", missing: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"] },
    ]);
  });

  it("does not run the cleanup twice within a day", () => {
    const records = { "scan-cleanup": rec({ lastRunAt: iso(NOW - 3 * HOUR), lastCompletedAt: iso(NOW - 3 * HOUR), lastStatus: "complete" as const }) };
    expect(planTasks({ now: NOW, records, env: ENV }).due).not.toContain("scan-cleanup");
  });

  it("retries a partial or failed weekly task the next day instead of waiting a week", () => {
    expect(isDue(TASKS["series-sync"], rec({ lastRunAt: iso(NOW - 24 * HOUR), lastStatus: "partial" }), NOW)).toBe(true);
    expect(isDue(TASKS["series-sync"], rec({ lastRunAt: iso(NOW - 24 * HOUR), lastStatus: "error" }), NOW)).toBe(true);
    expect(isDue(TASKS["series-sync"], rec({ lastRunAt: iso(NOW - 3 * HOUR), lastStatus: "partial" }), NOW)).toBe(false);
  });

  it("measures the week from the last completed run, not a later partial one", () => {
    expect(isDue(TASKS.recommendations, rec({ lastRunAt: iso(NOW - 3 * DAY), lastCompletedAt: iso(NOW - 3 * DAY), lastStatus: "complete" }), NOW)).toBe(false);
  });

  it("skips a task whose environment variable is missing, and says which", () => {
    const plan = planTasks({ now: NOW, records: {}, env: { HARDCOVER_API_TOKEN: "x" } });
    expect(plan.due).toEqual(["scan-cleanup", "series-sync"]);
    expect(plan.skipped).toEqual([
      { task: "price-refresh", reason: "env-missing", missing: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"] },
      { task: "recommendations", reason: "env-missing", missing: ["ANTHROPIC_API_KEY"] },
    ]);
    expect(planTasks({ now: NOW, records: {}, env: {} }).due).toEqual(["scan-cleanup"]);
  });
});

function memoryStore(initial: Partial<Record<TaskId, RunRecord>> = {}) {
  const records = { ...initial };
  const saves: { task: TaskId; row: Parameters<RunStore["save"]>[1] }[] = [];
  const store: RunStore = {
    load: async () => records,
    save: async (task, row) => {
      saves.push({ task, row });
      records[task] = { lastRunAt: row.lastRunAt, lastCompletedAt: row.lastCompletedAt ?? records[task]?.lastCompletedAt ?? null, lastStatus: row.lastStatus, cursor: row.cursor };
    },
  };
  return { store, saves, records };
}

const ok: TaskRunner = async () => ({ status: "complete", detail: { n: 1 } });

describe("runDaily", () => {
  it("runs due tasks in order, records each, and clears the cursor on completion", async () => {
    const { store, saves } = memoryStore({ "series-sync": rec({ lastRunAt: iso(NOW - DAY), lastStatus: "partial", cursor: { after: "lib-1" } }) });
    const seen: unknown[] = [];
    const runners = {
      "scan-cleanup": ok,
      "series-sync": vi.fn(async (ctx) => {
        seen.push(ctx.cursor);
        return { status: "complete" as const };
      }),
      "price-refresh": ok,
      recommendations: ok,
    };
    const out = await runDaily({ store, runners, env: ENV, budgetMs: 100_000, now: () => NOW });
    expect(out.ran.map((r) => `${r.task}:${r.status}`)).toEqual(["scan-cleanup:complete", "series-sync:complete", "recommendations:complete"]);
    expect(seen).toEqual([{ after: "lib-1" }]);
    expect(saves.find((s) => s.task === "series-sync")?.row).toMatchObject({ lastStatus: "complete", cursor: null });
    expect(saves.find((s) => s.task === "series-sync")?.row.lastCompletedAt).toBeDefined();
  });

  it("keeps the cursor and no completion time on a partial run", async () => {
    const { store, saves } = memoryStore();
    const runners = { "scan-cleanup": ok, "series-sync": async () => ({ status: "partial" as const, cursor: { after: "lib-9" }, detail: { left: 3 } }), "price-refresh": ok, recommendations: ok };
    await runDaily({ store, runners, env: ENV, budgetMs: 100_000, now: () => NOW });
    const row = saves.find((s) => s.task === "series-sync")!.row;
    expect(row).toMatchObject({ lastStatus: "partial", cursor: { after: "lib-9" }, detail: { left: 3 } });
    expect(row.lastCompletedAt).toBeUndefined();
  });

  it("a failing task is recorded and does not stop the others", async () => {
    const { store, saves } = memoryStore();
    const runners = { "scan-cleanup": async () => { throw new Error("storage down"); }, "series-sync": ok, "price-refresh": ok, recommendations: ok };
    const out = await runDaily({ store, runners, env: ENV, budgetMs: 100_000, now: () => NOW });
    expect(out.ran.map((r) => r.status)).toEqual(["error", "complete", "complete"]);
    expect(saves[0]).toMatchObject({ task: "scan-cleanup", row: { lastStatus: "error", detail: { error: "storage down" } } });
  });

  it("does not run, or record, a task whose env var is missing", async () => {
    const { store, saves } = memoryStore();
    const rec2 = vi.fn(ok);
    const out = await runDaily({ store, runners: { "scan-cleanup": ok, "series-sync": ok, "price-refresh": ok, recommendations: rec2 }, env: { HARDCOVER_API_TOKEN: "x" }, budgetMs: 100_000, now: () => NOW });
    expect(rec2).not.toHaveBeenCalled();
    expect(out.skipped).toContainEqual({ task: "recommendations", reason: "env-missing", missing: ["ANTHROPIC_API_KEY"] });
    expect(saves.map((s) => s.task)).toEqual(["scan-cleanup", "series-sync"]);
  });

  it("gives each task its share of the budget and the last one the remainder", async () => {
    const { store } = memoryStore();
    const deadlines: Record<string, number> = {};
    const runner = (name: string): TaskRunner => async (ctx) => {
      deadlines[name] = ctx.deadline - NOW;
      return { status: "complete" };
    };
    await runDaily({ store, runners: { "scan-cleanup": runner("a"), "series-sync": runner("b"), "price-refresh": runner("p"), recommendations: runner("c") }, env: ENV, budgetMs: 100_000, now: () => NOW });
    expect(deadlines).toEqual({ a: 10_000, b: 40_000, c: 100_000 });
  });

  it("leaves a task due when the time is already spent", async () => {
    const { store, saves } = memoryStore();
    let t = NOW;
    const slow: TaskRunner = async () => {
      t += 99_000;
      return { status: "complete" };
    };
    const rec3 = vi.fn(ok);
    const out = await runDaily({ store, runners: { "scan-cleanup": slow, "series-sync": rec3, "price-refresh": rec3, recommendations: rec3 }, env: ENV, budgetMs: 100_000, now: () => t });
    expect(out.ran.map((r) => r.status)).toEqual(["complete", "not-run", "not-run"]);
    expect(rec3).not.toHaveBeenCalled();
    expect(saves.map((s) => s.task)).toEqual(["scan-cleanup"]);
  });
});
