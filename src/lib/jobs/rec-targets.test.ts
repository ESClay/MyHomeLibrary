import { describe, expect, it } from "vitest";
import { REFRESH_AFTER_MS, pickDueTargets } from "./rec-targets";

const NOW = Date.parse("2026-11-15T04:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const DAY = 86_400_000;

const memberships = [
  { userId: "alice", libraryId: "L1" },
  { userId: "bob", libraryId: "L1" },
  { userId: "carol", libraryId: "L2" },
  { userId: "dave", libraryId: "L3" },
  { userId: "erin", libraryId: "L3" },
];

describe("pickDueTargets", () => {
  it("covers only active people, plus the shared set of their multi-member libraries", () => {
    const t = pickDueTargets({ activeUserIds: new Set(["alice", "carol"]), memberships, lastSets: [], now: NOW });
    const keys = t.map((x) => `${x.scope}:${x.libraryId}:${x.userId ?? "-"}`).sort();
    expect(keys).toEqual(["personal:L1:alice", "personal:L2:carol", "shared:L1:-"]);
    // Bob is inactive: no personal set for him, but the shared set of his library still counts.
    expect(t.find((x) => x.scope === "shared")?.memberIds).toEqual(["alice", "bob"]);
  });

  it("skips a library with one member for the shared set", () => {
    const t = pickDueTargets({ activeUserIds: new Set(["carol"]), memberships, lastSets: [], now: NOW });
    expect(t.map((x) => x.scope)).toEqual(["personal"]);
  });

  it("leaves fresh sets alone and refreshes week-old ones", () => {
    const t = pickDueTargets({
      activeUserIds: new Set(["alice", "bob"]),
      memberships,
      lastSets: [
        { scope: "personal", libraryId: "L1", userId: "alice", generatedAt: ago(2 * DAY) },
        { scope: "personal", libraryId: "L1", userId: "bob", generatedAt: ago(REFRESH_AFTER_MS + 1000) },
        { scope: "shared", libraryId: "L1", userId: null, generatedAt: ago(3 * DAY) },
      ],
      now: NOW,
    });
    expect(t.map((x) => `${x.scope}:${x.userId}`)).toEqual(["personal:bob"]);
  });

  it("puts never-generated first, then the stalest", () => {
    const t = pickDueTargets({
      activeUserIds: new Set(["alice", "bob", "carol"]),
      memberships,
      lastSets: [
        { scope: "personal", libraryId: "L1", userId: "alice", generatedAt: ago(20 * DAY) },
        { scope: "personal", libraryId: "L1", userId: "bob", generatedAt: ago(9 * DAY) },
      ],
      now: NOW,
    });
    expect(t.map((x) => x.userId ?? "shared")).toEqual(["carol", "shared", "alice", "bob"]);
  });
});
