/**
 * Turns a model's raw picks into a stored set: ask, resolve each pick through the catalogue, drop what cannot be
 * used, and top up once if too few are left. At most two model calls. Pure apart from the injected dependencies.
 */
import type { BuiltPrompt, TopUp } from "@/lib/ai/recommend-prompt";
import { TOP_UP_MARGIN } from "@/lib/ai/recommend-prompt";
import { RecommendError, type RecommendResult, type RecommendUsage } from "@/lib/ai/recommend";
import type { PersonalCategory, RawPick, RecommendScope } from "@/lib/ai/recommend-schema";
import type { BookMetadata } from "@/lib/metadata/types";
import { createLimiter } from "@/lib/scan/limiter";
import { MATCH_THRESHOLD, rankCandidates } from "@/lib/scan/resolve";
import { workKey, type Candidate } from "./match";
import type { DropCounts, StoredPick } from "./types";

export const MAX_MODEL_CALLS = 2;
const RESOLVE_CONCURRENCY = 3;
const DESCRIPTION_MAX = 600;

export type PickSetDeps = {
  /** Builds the prompt; called again with a TopUp for the replacement request. */
  prompt: (topUp?: TopUp) => BuiltPrompt;
  request: (prompt: BuiltPrompt, scope: RecommendScope) => Promise<RecommendResult>;
  search: (query: string) => Promise<BookMetadata[]>;
  inLibrary: (c: Candidate) => boolean;
  /** Work keys the person(s) marked not interested or already read. */
  blocked: ReadonlySet<string>;
};

export type PickSet = {
  items: StoredPick[];
  calls: number;
  usage: RecommendUsage;
  model: string | null;
  dropped: DropCounts;
  /** Set when the top-up request failed; the first round's picks are still returned. */
  topUpError: string | null;
};

/** The catalogue record for a pick: the best title+author match among a search's results, or null. */
export async function resolvePick(pick: Pick<RawPick, "title" | "authors">, search: PickSetDeps["search"]): Promise<BookMetadata | null> {
  let hits: BookMetadata[];
  try {
    hits = await search(`${pick.title} ${pick.authors[0] ?? ""}`.trim());
  } catch {
    return null;
  }
  const best = rankCandidates(pick, hits)[0];
  return best && best.score >= MATCH_THRESHOLD ? best.c : null;
}

const trimBook = (b: BookMetadata): BookMetadata => ({
  ...b,
  description: b.description && b.description.length > DESCRIPTION_MAX ? `${b.description.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : b.description,
  covers: b.covers.slice(0, 3),
});

export type CategoryTargets = Partial<Record<PersonalCategory, number>>;

/** How many more each group needs to reach its target. Groups already full are left out. */
export function categoryShortfall(targets: CategoryTargets, have: Partial<Record<PersonalCategory, number>>): CategoryTargets {
  const out: CategoryTargets = {};
  for (const [c, want] of Object.entries(targets) as [PersonalCategory, number][]) {
    const missing = want - (have[c] ?? 0);
    if (missing > 0) out[c] = missing;
  }
  return out;
}

/**
 * `target` is the size of the whole set. A personal set may also pass `categoryTargets` (picks wanted per group): a
 * pick only counts while its group is short, so one group cannot crowd out another, and the top-up asks only for the
 * groups that are still short. Without them every pick counts toward `target` alone.
 */
export async function buildPickSet(input: { scope: RecommendScope; target: number; categoryTargets?: CategoryTargets; deps: PickSetDeps }): Promise<PickSet> {
  const { scope, deps, categoryTargets } = input;
  const target = categoryTargets ? Object.values(categoryTargets).reduce((n, v) => n + (v ?? 0), 0) : input.target;
  const have: Partial<Record<PersonalCategory, number>> = {};
  const items: StoredPick[] = [];
  const dropped: DropCounts = { notFound: 0, inLibrary: 0, blocked: 0, duplicate: 0 };
  const usage: RecommendUsage = { inputTokens: 0, outputTokens: 0 };
  const seen = new Set<string>();
  const rejectedTitles: string[] = [];
  let model: string | null = null;
  let calls = 0;
  let topUpError: string | null = null;

  const full = () => items.length >= target;

  async function round(topUp?: TopUp) {
    const prompt = deps.prompt(topUp);
    calls++;
    let result: RecommendResult;
    try {
      result = await deps.request(prompt, scope);
    } catch (e) {
      if (e instanceof RecommendError && e.usage) {
        usage.inputTokens += e.usage.inputTokens;
        usage.outputTokens += e.usage.outputTokens;
      }
      throw e;
    }
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    model = result.model;

    const run = createLimiter(RESOLVE_CONCURRENCY);
    const resolved = await Promise.all(result.picks.map((p) => run(() => resolvePick(p, deps.search))));

    result.picks.forEach((pick, i) => {
      if (full()) return;
      const cat = categoryTargets ? pick.category : undefined;
      // A group that is already full (or one that was not asked for) takes no more picks.
      if (categoryTargets && (!cat || (have[cat] ?? 0) >= (categoryTargets[cat] ?? 0))) return;
      const meta = resolved[i];
      const rawKey = workKey(pick.title, pick.authors);
      const reject = (why: keyof DropCounts) => {
        dropped[why]++;
        rejectedTitles.push(pick.title);
      };
      if (!meta) return reject("notFound");
      const key = workKey(meta.title, meta.authors);
      if (deps.blocked.has(key) || deps.blocked.has(rawKey)) return reject("blocked");
      const candidate: Candidate = { title: meta.title, authors: meta.authors, isbn13s: [meta.isbn13], hardcoverId: meta.ids.hardcover ?? null };
      if (deps.inLibrary(candidate) || deps.inLibrary({ ...candidate, title: pick.title, authors: pick.authors, isbn13s: [], hardcoverId: null })) {
        return reject("inLibrary");
      }
      if (seen.has(key) || seen.has(rawKey)) {
        dropped.duplicate++;
        return;
      }
      seen.add(key);
      seen.add(rawKey);
      items.push({
        key,
        title: meta.title,
        authors: meta.authors.length ? meta.authors : pick.authors,
        reason: pick.reason,
        fit: pick.fit,
        series: pick.series ? { name: pick.series, position: pick.seriesPosition } : meta.seriesName ? { name: meta.seriesName, position: meta.seriesPosition } : null,
        ...(cat ? { category: cat } : {}),
        book: trimBook(meta),
      });
      if (cat) have[cat] = (have[cat] ?? 0) + 1;
    });
  }

  await round(); // a failure here is the caller's to handle: nothing was produced
  if (!full() && calls < MAX_MODEL_CALLS) {
    try {
      const short = categoryTargets ? categoryShortfall(categoryTargets, have) : undefined;
      const perCategory = short && Object.fromEntries(Object.entries(short).map(([c, n]) => [c, n + TOP_UP_MARGIN]));
      const need = short ? Object.values(perCategory ?? {}).reduce((n, v) => n + v, 0) : target - items.length + TOP_UP_MARGIN;
      await round({ need, avoid: [...rejectedTitles, ...items.map((i) => i.title)], ...(perCategory ? { perCategory } : {}) });
    } catch (e) {
      topUpError = e instanceof Error ? e.message : "The top-up failed.";
    }
  }
  return { items, calls, usage, model, dropped, topUpError };
}

