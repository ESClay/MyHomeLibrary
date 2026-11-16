import { z } from "zod";
import { FORMATS, OWNERSHIPS, OWNERSHIP_LABEL, FORMAT_LABEL, STATUSES, STATUS_LABEL } from "@/lib/books/constants";
import {
  MAX_LIMIT,
  defaultDir,
  parseLibraryParams,
  type LibraryParams,
} from "@/lib/books/library-query";
import { SHELF_SORT_TO_LIBRARY, type ShelfSort } from "./constants";

/**
 * Smart-shelf rules are exactly the library list's filter params, stored as JSON. There is no second
 * filter engine: evaluation goes through parseLibraryParams and applyLibraryQuery (lib/books/library-query).
 */
const shape = {
  q: z.string().trim().min(1).max(100),
  my: z.enum([...STATUSES, "none"]),
  partner: z.enum(STATUSES),
  format: z.enum(FORMATS),
  own: z.enum(OWNERSHIPS),
  series: z.string().trim().min(1).max(200),
  rating: z.union([z.literal("unrated"), z.number().min(0.5).max(5)]),
} as const;

export const RULE_KEYS = Object.keys(shape) as (keyof typeof shape)[];

/** Unknown keys are dropped (zod strips them). */
export const shelfRulesSchema = z.object({
  q: shape.q.optional(),
  my: shape.my.optional(),
  partner: shape.partner.optional(),
  format: shape.format.optional(),
  own: shape.own.optional(),
  series: shape.series.optional(),
  rating: shape.rating.optional(),
});
export type ShelfRules = z.infer<typeof shelfRulesSchema>;

export const hasRules = (r: ShelfRules) => RULE_KEYS.some((k) => r[k] !== undefined);

/** For saving: at least one rule, so a smart shelf is never just "everything". */
export const saveRulesSchema = shelfRulesSchema.refine(hasRules, "Choose at least one filter for a smart shelf.");

/**
 * For reading stored JSON: keeps every valid key and drops the rest, so a rule that went stale
 * (a renamed status, a hand edit) loses only itself rather than the whole shelf.
 */
export function readRules(raw: unknown): ShelfRules {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of RULE_KEYS) {
    if (obj[key] === undefined || obj[key] === null) continue;
    const r = shape[key].safeParse(obj[key]);
    if (r.success) out[key] = r.data;
  }
  return out as ShelfRules;
}

/** The library params a rule set stands for. "My status" resolves for whoever evaluates it. */
export function paramsFromRules(rules: ShelfRules, sort: ShelfSort = "series"): LibraryParams {
  const s = sort === "custom" ? "series" : sort;
  const lib = SHELF_SORT_TO_LIBRARY[s];
  return parseLibraryParams({
    q: rules.q,
    my: rules.my,
    partner: rules.partner,
    format: rules.format,
    own: rules.own,
    series: rules.series,
    rating: rules.rating === undefined ? undefined : String(rules.rating),
    sort: lib,
    dir: defaultDir(lib),
    limit: String(MAX_LIMIT),
  });
}

/** The filter part of library params, as rules. Sort, direction and paging are the shelf's own. */
export function rulesFromParams(p: LibraryParams): ShelfRules {
  const out: ShelfRules = {};
  if (p.q) out.q = p.q;
  if (p.my) out.my = p.my;
  if (p.partner) out.partner = p.partner;
  if (p.format) out.format = p.format;
  if (p.own) out.own = p.own;
  if (p.series) out.series = p.series;
  if (p.rating !== null) out.rating = p.rating;
  return out;
}

export type RuleChip = { key: keyof ShelfRules; label: string };

/** Readable chips for the shelf header. */
export function describeRules(rules: ShelfRules): RuleChip[] {
  const chips: RuleChip[] = [];
  if (rules.q) chips.push({ key: "q", label: `Matches “${rules.q}”` });
  if (rules.my) chips.push({ key: "my", label: rules.my === "none" ? "I have no status" : `I: ${STATUS_LABEL[rules.my].toLowerCase()}` });
  if (rules.partner) chips.push({ key: "partner", label: `Partner: ${STATUS_LABEL[rules.partner].toLowerCase()}` });
  if (rules.format) chips.push({ key: "format", label: FORMAT_LABEL[rules.format] });
  if (rules.own) chips.push({ key: "own", label: OWNERSHIP_LABEL[rules.own] });
  if (rules.series) chips.push({ key: "series", label: `Series: ${rules.series}` });
  if (rules.rating !== undefined) {
    chips.push({ key: "rating", label: rules.rating === "unrated" ? "Not rated yet" : `${rules.rating} stars and up` });
  }
  return chips;
}

/** The library URL that opens the filter UI prefilled with a shelf's rules (and edit mode for that shelf). */
export function rulesQueryString(rules: ShelfRules): string {
  const sp = new URLSearchParams();
  for (const k of RULE_KEYS) if (rules[k] !== undefined) sp.set(k, String(rules[k]));
  return sp.toString();
}
