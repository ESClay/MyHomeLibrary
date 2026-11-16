/**
 * The daily cron dispatcher: decides which tasks are due, runs each within its slice of the time budget, and records
 * the outcome. Every dependency is injected, so the scheduling is tested without a database or a clock.
 */
import { TASKS, planTasks, type RunRecord, type RunStatus, type TaskId } from "./schedule";

export type TaskOutcome = { status: "complete" | "partial"; detail?: Record<string, unknown>; cursor?: unknown };
export type TaskContext = { deadline: number; cursor: unknown; now: () => number };
export type TaskRunner = (ctx: TaskContext) => Promise<TaskOutcome>;

export type RunStore = {
  load(): Promise<Partial<Record<TaskId, RunRecord>>>;
  save(task: TaskId, row: { lastRunAt: string; lastCompletedAt?: string; lastStatus: RunStatus; detail: Record<string, unknown>; cursor: unknown }): Promise<void>;
};

export type TaskReport = { task: TaskId; status: RunStatus | "not-run"; detail?: Record<string, unknown>; reason?: string };

export type DailyResult = { ran: TaskReport[]; skipped: { task: TaskId; reason: string; missing?: string[] }[] };

/** A task needs at least this long to be worth starting. */
export const MIN_TASK_MS = 5_000;

export async function runDaily(input: {
  store: RunStore;
  runners: Record<TaskId, TaskRunner>;
  env: Record<string, string | undefined>;
  budgetMs: number;
  now?: () => number;
}): Promise<DailyResult> {
  const now = input.now ?? Date.now;
  const started = now();
  const overall = started + input.budgetMs;
  const records = await input.store.load();
  const plan = planTasks({ now: started, records, env: input.env });
  const result: DailyResult = { ran: [], skipped: plan.skipped.map((s) => ({ ...s })) };

  for (let i = 0; i < plan.due.length; i++) {
    const task = plan.due[i];
    const left = overall - now();
    if (left < MIN_TASK_MS) {
      result.ran.push({ task, status: "not-run", reason: "out of time; it stays due for the next run" });
      continue;
    }
    // A task gets its share of the whole budget; the last due task also gets whatever is left.
    const isLast = i === plan.due.length - 1;
    const slice = isLast ? left : Math.min(left, Math.floor(input.budgetMs * TASKS[task].budgetShare));
    const deadline = now() + slice;
    const runAt = new Date(now()).toISOString();
    try {
      const outcome = await input.runners[task]({ deadline, cursor: records[task]?.cursor ?? null, now });
      await input.store.save(task, {
        lastRunAt: runAt,
        ...(outcome.status === "complete" ? { lastCompletedAt: new Date(now()).toISOString() } : {}),
        lastStatus: outcome.status,
        detail: outcome.detail ?? {},
        cursor: outcome.status === "complete" ? null : (outcome.cursor ?? null),
      });
      result.ran.push({ task, status: outcome.status, detail: outcome.detail });
    } catch (e) {
      const message = e instanceof Error ? e.message : "failed";
      // One task failing never stops the others; it is retried on the next run.
      await input.store
        .save(task, { lastRunAt: runAt, lastStatus: "error", detail: { error: message }, cursor: records[task]?.cursor ?? null })
        .catch(() => undefined);
      result.ran.push({ task, status: "error", detail: { error: message } });
    }
  }
  return result;
}
