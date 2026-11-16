import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RecommendError } from "@/lib/ai/recommend";
import { getEbayClient } from "@/lib/pricing/ebay";
import { recordNoPrice, recordPrice } from "@/lib/pricing/record";
import { runPriceRefresh, type Candidate } from "@/lib/pricing/refresh";
import { CapReached, NotEnoughSignal, generateSet } from "@/lib/discover/recs";
import { syncLibrarySeries } from "@/lib/discover/series-sync";
import type { RunStore, TaskRunner } from "./daily";
import { ACTIVE_WINDOW_MS, pickDueTargets, type LastSet, type Membership } from "./rec-targets";
import { cleanupScanBatch } from "./scan-cleanup";
import type { RunRecord, TaskId } from "./schedule";

/** A single generation can take a couple of minutes at high effort; do not start one without this much time left. */
export const MIN_GENERATION_MS = 100_000;

// ------------------------------------------------------------------ run log

export function supabaseRunStore(admin: SupabaseClient): RunStore {
  return {
    async load() {
      const { data, error } = await admin.from("cron_runs").select("task, last_run_at, last_completed_at, last_status, cursor");
      if (error) throw new Error(`cron_runs: ${error.message}`);
      const out: Partial<Record<TaskId, RunRecord>> = {};
      for (const r of data ?? []) {
        out[r.task as TaskId] = { lastRunAt: r.last_run_at, lastCompletedAt: r.last_completed_at, lastStatus: r.last_status, cursor: r.cursor };
      }
      return out;
    },
    async save(task, row) {
      const { error } = await admin.from("cron_runs").upsert(
        {
          task,
          last_run_at: row.lastRunAt,
          ...(row.lastCompletedAt ? { last_completed_at: row.lastCompletedAt } : {}),
          last_status: row.lastStatus,
          last_detail: row.detail,
          cursor: row.cursor,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "task" },
      );
      if (error) throw new Error(`cron_runs: ${error.message}`);
    },
  };
}

// ------------------------------------------------------------------ tasks

export function scanCleanupTask(admin: SupabaseClient): TaskRunner {
  return async ({ deadline, now }) => {
    let removed = 0;
    let abandoned = 0;
    for (;;) {
      const batch = await cleanupScanBatch(admin, now());
      removed += batch.removed;
      abandoned += batch.abandoned;
      if (!batch.more) return { status: "complete", detail: { removed, abandoned } };
      if (now() > deadline - 5_000) return { status: "partial", detail: { removed, abandoned } };
    }
  };
}

/** Walks the libraries in id order, re-syncing each one's stale series, until the time runs out (then resumes after the last finished library). */
export function seriesSyncTask(admin: SupabaseClient): TaskRunner {
  return async ({ deadline, cursor, now }) => {
    let after = (cursor as { after?: string } | null)?.after ?? "";
    let libraries = 0;
    let syncedSeries = 0;
    let linkedBooks = 0;
    const errors: string[] = [];

    for (;;) {
      const { data, error } = await admin.from("libraries").select("id").gt("id", after).order("id").limit(10);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) return { status: "complete", detail: { libraries, syncedSeries, linkedBooks, errors: errors.slice(0, 5) } };

      for (const lib of data) {
        const left = deadline - now();
        if (left < 15_000) return { status: "partial", cursor: { after }, detail: { libraries, syncedSeries, linkedBooks, reason: "out of time" } };
        const res = await syncLibrarySeries(admin, lib.id as string, { budgetMs: left });
        syncedSeries += res.syncedSeries;
        linkedBooks += res.linkedBooks;
        errors.push(...res.errors);
        if (res.rateLimited || res.remaining > 0) {
          // Stay on this library next time: the cursor is the one before it.
          return { status: "partial", cursor: { after }, detail: { libraries, syncedSeries, linkedBooks, rateLimited: res.rateLimited, remaining: res.remaining } };
        }
        libraries++;
        after = lib.id as string;
      }
    }
  };
}

async function activeUserIds(admin: SupabaseClient, now: number): Promise<Set<string>> {
  const since = new Date(now - ACTIVE_WINDOW_MS).toISOString();
  const ids = new Set<string>();
  const [reads, added, manual] = await Promise.all([
    admin.from("user_books").select("user_id").gte("updated_at", since).limit(5000),
    admin.from("books").select("added_by").gte("created_at", since).not("added_by", "is", null).limit(5000),
    admin.from("recommendation_sets").select("user_id").eq("scope", "personal").eq("trigger_source", "manual").gte("generated_at", since).limit(5000),
  ]);
  for (const r of reads.data ?? []) ids.add(r.user_id as string);
  for (const r of added.data ?? []) ids.add(r.added_by as string);
  for (const r of manual.data ?? []) ids.add(r.user_id as string);
  return ids;
}

export function recommendationsTask(admin: SupabaseClient): TaskRunner {
  return async ({ deadline, now }) => {
    const t0 = now();
    const active = await activeUserIds(admin, t0);
    if (active.size === 0) return { status: "complete", detail: { active: 0, generated: 0 } };

    const { data: members, error } = await admin.from("library_members").select("user_id, library_id");
    if (error) throw new Error(error.message);
    const memberships: Membership[] = (members ?? []).map((m) => ({ userId: m.user_id as string, libraryId: m.library_id as string }));
    const libraryIds = [...new Set(memberships.filter((m) => active.has(m.userId)).map((m) => m.libraryId))];
    const { data: sets } = await admin
      .from("recommendation_sets")
      .select("scope, library_id, user_id, generated_at")
      .eq("status", "ok")
      .in("library_id", libraryIds.length ? libraryIds : ["00000000-0000-0000-0000-000000000000"]);
    const lastSets: LastSet[] = (sets ?? []).map((s) => ({ scope: s.scope, libraryId: s.library_id as string, userId: s.user_id as string | null, generatedAt: s.generated_at as string }));

    const targets = pickDueTargets({ activeUserIds: active, memberships, lastSets, now: t0 });
    let generated = 0;
    let notEnough = 0;
    let tokens = 0;
    const errors: string[] = [];

    for (const t of targets) {
      if (deadline - now() < MIN_GENERATION_MS) {
        return { status: "partial", detail: { generated, notEnough, tokens, left: targets.length - generated - notEnough, errors } };
      }
      try {
        const out = await generateSet({
          client: admin,
          scope: t.scope,
          libraryId: t.libraryId,
          userId: t.userId,
          trigger: "cron",
          // The cron job is the one place that can read every member's feedback to filter a shared set.
          blockFor: t.memberIds,
        });
        generated++;
        tokens += out.usage.inputTokens + out.usage.outputTokens;
      } catch (e) {
        if (e instanceof NotEnoughSignal || e instanceof CapReached) {
          notEnough++;
        } else if (e instanceof RecommendError && (e.kind === "config" || e.kind === "busy")) {
          errors.push(e.kind);
          return { status: "partial", detail: { generated, notEnough, tokens, errors } };
        } else {
          errors.push(e instanceof Error ? e.message.slice(0, 120) : "failed");
        }
      }
    }
    return { status: "complete", detail: { generated, notEnough, tokens, errors } };
  };
}

/**
 * Daily price refresh. Selects physical copies with an ISBN that were last priced more than 7 days ago (or never), stalest first,
 * across libraries, skipping libraries with no price_region; see lib/pricing/refresh.ts for the call and time limits.
 */
export function priceRefreshTask(admin: SupabaseClient): TaskRunner {
  const ebay = getEbayClient();
  return ({ deadline, cursor, now }) =>
    runPriceRefresh(
      {
        async fetchCandidates(cutoffIso, limit) {
          const { data, error } = await admin.rpc("price_refresh_candidates", { cutoff: cutoffIso, max_rows: limit });
          if (error) throw new Error(`price_refresh_candidates: ${error.message}`);
          return ((data ?? []) as { copy_id: string; format: string; condition: Candidate["condition"]; isbn: string; price_region: string }[]).map((r) => ({
            copyId: r.copy_id,
            format: r.format,
            condition: r.condition,
            isbn: r.isbn,
            priceRegion: r.price_region,
          }));
        },
        price: (req) => ebay.price(req),
        recordPriced: (c, res) => recordPrice(admin, c.copyId, res, new Date(now())),
        recordNoPrice: (c) => recordNoPrice(admin, c.copyId, new Date(now())),
        now,
      },
      { deadline, cursor },
    );
}
