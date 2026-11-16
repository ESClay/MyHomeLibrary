/** Who the weekly recommendation refresh should generate for. Pure. */

export type Membership = { userId: string; libraryId: string };
export type LastSet = { scope: "personal" | "shared"; libraryId: string; userId: string | null; generatedAt: string };
export type RecTarget = { scope: "personal" | "shared"; libraryId: string; userId: string | null; memberIds: string[] };

/** Active in the last 30 days. */
export const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** A set younger than this is left alone. */
export const REFRESH_AFTER_MS = 6.5 * 24 * 60 * 60 * 1000;

/**
 * Personal sets for each active person in each of their libraries, and a shared set for every library that has at
 * least two members and at least one active member. Only targets whose latest set is older than a week (or missing),
 * never-generated first and then the stalest.
 */
export function pickDueTargets(input: { activeUserIds: Set<string>; memberships: Membership[]; lastSets: LastSet[]; now: number }): RecTarget[] {
  const membersOf = new Map<string, string[]>();
  for (const m of input.memberships) membersOf.set(m.libraryId, [...(membersOf.get(m.libraryId) ?? []), m.userId]);

  const latest = new Map<string, number>();
  for (const s of input.lastSets) {
    const key = `${s.scope}|${s.libraryId}|${s.userId ?? ""}`;
    latest.set(key, Math.max(latest.get(key) ?? 0, new Date(s.generatedAt).getTime()));
  }
  const dueAge = (key: string) => {
    const at = latest.get(key);
    return at === undefined ? Infinity : input.now - at;
  };

  const out: (RecTarget & { age: number })[] = [];
  const libraries = new Set<string>();
  for (const m of input.memberships) {
    if (!input.activeUserIds.has(m.userId)) continue;
    libraries.add(m.libraryId);
    const age = dueAge(`personal|${m.libraryId}|${m.userId}`);
    if (age >= REFRESH_AFTER_MS) out.push({ scope: "personal", libraryId: m.libraryId, userId: m.userId, memberIds: [m.userId], age });
  }
  for (const libraryId of libraries) {
    const members = membersOf.get(libraryId) ?? [];
    if (members.length < 2) continue;
    const age = dueAge(`shared|${libraryId}|`);
    if (age >= REFRESH_AFTER_MS) out.push({ scope: "shared", libraryId, userId: null, memberIds: members, age });
  }
  return out.sort((a, b) => b.age - a.age).map((t) => ({ scope: t.scope, libraryId: t.libraryId, userId: t.userId, memberIds: t.memberIds }));
}
