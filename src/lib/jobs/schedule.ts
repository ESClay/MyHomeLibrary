/** Which daily-cron tasks are due. Pure: the clock, the last-run records and the environment are passed in. */

export type TaskId = "scan-cleanup" | "series-sync" | "recommendations";
export const TASK_ORDER: TaskId[] = ["scan-cleanup", "series-sync", "recommendations"];

export type RunStatus = "complete" | "partial" | "error" | "skipped";

export type RunRecord = {
  lastRunAt: string | null;
  lastCompletedAt: string | null;
  lastStatus: RunStatus | null;
  cursor: unknown;
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export type TaskDef = {
  label: string;
  /** How long after a completed run the task is due again. */
  intervalMs: number;
  /** How long after a partial or failed run it is tried again (so a long job resumes the next day). */
  retryMs: number;
  /** Environment variables the task cannot run without. */
  requiredEnv: string[];
  /** Share of the run's time budget, 0 to 1; the last task also gets what the others left over. */
  budgetShare: number;
};

export const TASKS: Record<TaskId, TaskDef> = {
  "scan-cleanup": { label: "Scan photo cleanup", intervalMs: 20 * HOUR, retryMs: 20 * HOUR, requiredEnv: [], budgetShare: 0.1 },
  "series-sync": { label: "Series re-sync", intervalMs: 6.5 * DAY, retryMs: 20 * HOUR, requiredEnv: ["HARDCOVER_API_TOKEN"], budgetShare: 0.4 },
  recommendations: { label: "Recommendation refresh", intervalMs: 6.5 * DAY, retryMs: 20 * HOUR, requiredEnv: ["ANTHROPIC_API_KEY"], budgetShare: 0.5 },
};

export type Plan = {
  due: TaskId[];
  skipped: { task: TaskId; reason: "not-due" | "env-missing"; missing?: string[] }[];
};

export function isDue(def: TaskDef, rec: RunRecord | undefined, now: number): boolean {
  if (!rec || !rec.lastRunAt) return true;
  const ran = new Date(rec.lastRunAt).getTime();
  if (rec.lastStatus === "partial" || rec.lastStatus === "error") return now - ran >= def.retryMs;
  const since = new Date(rec.lastCompletedAt ?? rec.lastRunAt).getTime();
  return now - since >= def.intervalMs;
}

export function planTasks(input: { now: number; records: Partial<Record<TaskId, RunRecord>>; env: Record<string, string | undefined> }): Plan {
  const plan: Plan = { due: [], skipped: [] };
  for (const task of TASK_ORDER) {
    const def = TASKS[task];
    const missing = def.requiredEnv.filter((k) => !input.env[k]);
    if (missing.length > 0) {
      plan.skipped.push({ task, reason: "env-missing", missing });
      continue;
    }
    if (isDue(def, input.records[task], input.now)) plan.due.push(task);
    else plan.skipped.push({ task, reason: "not-due" });
  }
  return plan;
}
