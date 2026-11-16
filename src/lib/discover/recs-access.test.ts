/** generateSet is the one door to Claude for recommendations: it refuses before any model call without the entitlement. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/supabase-fake";

const requestPicks = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/recommend", () => ({
  requestPicks,
  RECOMMEND_MODEL: "test-model",
  RecommendError: class extends Error {},
}));

const GRANTED = new Set<string>();
const client = (members: { library_id: string; user_id: string }[] = []) =>
  fakeSupabase({ library_members: members, user_entitlements: [...GRANTED].map((user_id) => ({ user_id, full_access: true })) }, (fn, args) =>
    fn === "has_full_access" ? GRANTED.has(args.uid as string) : false,
  );

beforeEach(() => {
  vi.clearAllMocks();
  GRANTED.clear();
});

describe("generateSet access", () => {
  it.each(["personal", "shared"] as const)("refuses a manual %s refresh from an ungranted person", async (scope) => {
    const { generateSet, AccessDenied } = await import("./recs");
    const fake = client();
    await expect(generateSet({ client: fake as never, scope, libraryId: "L1", userId: "alice", trigger: "manual" })).rejects.toBeInstanceOf(AccessDenied);
    expect(requestPicks).not.toHaveBeenCalled();
    expect(fake.writes).toEqual([]);
  });

  it("refuses a cron personal set for an ungranted person", async () => {
    const { generateSet, AccessDenied } = await import("./recs");
    await expect(generateSet({ client: client() as never, scope: "personal", libraryId: "L1", userId: "alice", trigger: "cron" })).rejects.toBeInstanceOf(AccessDenied);
    expect(requestPicks).not.toHaveBeenCalled();
  });

  it("refuses a cron shared set for a library with no granted member", async () => {
    const { generateSet, AccessDenied } = await import("./recs");
    const fake = client([{ library_id: "L1", user_id: "alice" }]);
    await expect(generateSet({ client: fake as never, scope: "shared", libraryId: "L1", userId: null, trigger: "cron" })).rejects.toBeInstanceOf(AccessDenied);
  });

  it("lets a cron shared set through when one member is granted", async () => {
    GRANTED.add("bob");
    const { generateSet, AccessDenied } = await import("./recs");
    const fake = client([
      { library_id: "L1", user_id: "alice" },
      { library_id: "L1", user_id: "bob" },
    ]);
    // It then fails on the thin fake data (not enough ratings), which is a different error: the access check passed.
    const err = await generateSet({ client: fake as never, scope: "shared", libraryId: "L1", userId: null, trigger: "cron" }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(AccessDenied);
  });
});
