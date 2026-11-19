/**
 * What the model is asked to return for recommendations, and how the answer is checked.
 * Pure: no SDK, no network. The output is untrusted, so it is parsed defensively and malformed picks are dropped.
 */
import { z } from "zod";

export type RecommendScope = "personal" | "shared";

/**
 * The groups of the personal ("For you") set, in display order: books like what is on the shelves, books from what
 * the reader rated, and more by authors the library already holds. One model call fills every group.
 */
export const PERSONAL_CATEGORIES = ["shelves", "ratings", "authors"] as const;
export type PersonalCategory = (typeof PERSONAL_CATEGORIES)[number];
export const isPersonalCategory = (v: unknown): v is PersonalCategory => (PERSONAL_CATEGORIES as readonly unknown[]).includes(v);

/** Most picks kept from one answer, however many the model returned (three groups of a few picks each, plus margin). */
export const MAX_PICKS = 45;
const REASON_MAX = 500;

export type RawPick = {
  title: string;
  authors: string[];
  /** One or two sentences. For a shared pick, the per-person lines joined. */
  reason: string;
  /** Shared picks only: why it fits each person, by display name. */
  fit: { person: string; why: string }[];
  series: string | null;
  seriesPosition: number | null;
  /** Personal picks only: the group the model filed it under. */
  category?: PersonalCategory;
};

const commonProps = {
  title: { type: "string", description: "The book's title as published. Only a real book you are sure exists." },
  authors: { type: "array", items: { type: "string" }, description: "Its author or authors, as published." },
  series: { type: ["string", "null"], description: "The series it belongs to, or null if it is standalone or you are not sure." },
  seriesPosition: { type: ["number", "null"], description: "Its number in that series, or null when unknown." },
} as const;

/** JSON Schema for `output_config.format`. Every property is required and optional ones are nullable (strict decoding). */
export const PERSONAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["picks"],
  properties: {
    picks: {
      type: "array",
      description: "Recommended books, best first.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "title", "authors", "reason", "series", "seriesPosition"],
        properties: {
          category: {
            type: "string",
            enum: PERSONAL_CATEGORIES,
            description:
              "Which group this pick belongs to: shelves (like what the library holds), ratings (from the reader's own ratings and notes) or authors (another book by an author the library holds several of). Only the groups asked for.",
          },
          ...commonProps,
          reason: { type: "string", description: "One or two sentences on why this reader would like it, tied to what they rated or wrote." },
        },
      },
    },
  },
} as const;

export const SHARED_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["picks"],
  properties: {
    picks: {
      type: "array",
      description: "Books both people would likely enjoy, best first.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "authors", "fit", "series", "seriesPosition"],
        properties: {
          ...commonProps,
          fit: {
            type: "array",
            description: "One entry per person: why the book suits them, in one sentence.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["person", "why"],
              properties: {
                person: { type: "string", description: "The person's name exactly as given." },
                why: { type: "string", description: "One sentence on why it suits that person." },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const schemaFor = (scope: RecommendScope) => (scope === "personal" ? PERSONAL_SCHEMA : SHARED_SCHEMA);

const clean = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

const rawPersonal = z.object({
  category: z.string(),
  title: z.string(),
  authors: z.array(z.string()).default([]),
  reason: z.string(),
  series: z.string().nullish(),
  seriesPosition: z.number().nullish(),
});

const rawShared = z.object({
  title: z.string(),
  authors: z.array(z.string()).default([]),
  fit: z.array(z.object({ person: z.string(), why: z.string() })).default([]),
  series: z.string().nullish(),
  seriesPosition: z.number().nullish(),
});

export type ParsedPicks = { ok: true; picks: RawPick[]; dropped: number } | { ok: false };

/**
 * Parses the model's JSON. `people` (shared scope) are the display names the prompt used: a fit line for any other
 * name is discarded, names are matched case-insensitively and a pick left with no valid line is dropped. A personal
 * pick needs one of the asked-for `categories` (any, when none are given); others are dropped.
 */
export function parsePicks(text: string, scope: RecommendScope, people: string[] = [], categories?: readonly PersonalCategory[]): ParsedPicks {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  const list = (json as { picks?: unknown } | null)?.picks;
  if (!Array.isArray(list)) return { ok: false };

  const byLower = new Map(people.map((p) => [p.trim().toLowerCase(), p]));
  const picks: RawPick[] = [];
  let dropped = 0;

  for (const item of list.slice(0, MAX_PICKS * 2)) {
    if (picks.length >= MAX_PICKS) break;
    const parsed = scope === "personal" ? rawPersonal.safeParse(item) : rawShared.safeParse(item);
    if (!parsed.success) {
      dropped++;
      continue;
    }
    const d = parsed.data as unknown as z.infer<typeof rawPersonal> & z.infer<typeof rawShared>;
    const title = clean(d.title, 200);
    const authors = d.authors.map((a) => clean(a, 120)).filter(Boolean).slice(0, 4);
    if (!title || authors.length === 0) {
      dropped++;
      continue;
    }
    const series = d.series ? clean(d.series, 120) || null : null;
    const seriesPosition = series && typeof d.seriesPosition === "number" && Number.isFinite(d.seriesPosition) && d.seriesPosition >= 0 ? d.seriesPosition : null;

    if (scope === "personal") {
      const reason = clean(d.reason, REASON_MAX);
      if (!reason) {
        dropped++;
        continue;
      }
      if (!isPersonalCategory(d.category) || (categories && !categories.includes(d.category))) {
        dropped++;
        continue;
      }
      picks.push({ title, authors, reason, fit: [], series, seriesPosition, category: d.category });
    } else {
      const fit: RawPick["fit"] = [];
      for (const f of d.fit) {
        const person = byLower.get(f.person.trim().toLowerCase());
        const why = clean(f.why, 300);
        if (person && why && !fit.some((x) => x.person === person)) fit.push({ person, why });
      }
      if (fit.length === 0) {
        dropped++;
        continue;
      }
      picks.push({ title, authors, reason: clean(fit.map((f) => `${f.person}: ${f.why}`).join(" "), REASON_MAX * 2), fit, series, seriesPosition });
    }
  }
  return { ok: true, picks, dropped };
}
