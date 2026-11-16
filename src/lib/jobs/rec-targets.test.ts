import { describe, expect, it } from "vitest";
import { REFRESH_AFTER_MS, pickDueTargets } from "./rec-targets";

const NOW = Date.parse("2026-11-15T04:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const DAY = 86_400_000;
const everyone = new Set(["alice", "bob", "carol", "dave", "erin"]);

const memberships = [
  { userId: "alice", libraryId: "L1" },
  { userId: "bob", libraryId: "L1" },
  { userId: "carol", libraryId: "L2" },
  { userId: "dave", libraryId: "L3" },
  { userId: "erin", libraryId: "L3" },
];

describe("pickDueTargets", () => {
  it("covers only active people, plus the shared set of their multi-member libraries", () => {
    const t = pickDueTargets({ grantedUserIds: everyone, activeUserIds: new Set(["alice", "carol"]), memberships, lastSets: [], now: NOW });
    const keys = t.map((x) => `${x.scope}:${x.libraryId}:${x.userId ?? "-"}`).sort();
    expect(keys).toEqual(["personal:L1:alice", "personal:L2:carol", "shared:L1:-"]);
    // Bob is inactive: no personal set for him, but the shared set of his library still counts.
    expect(t.find((x) => x.scope === "shared")?.memberIds).toEqual(["alice", "bob"]);
  });

  it("skips a library with one member for the shared set", () => {
    const t = pickDueTargets({ grantedUserIds: everyone, activeUserIds: new Set(["carol"]), memberships, lastSets: [], now: NOW });
    expect(t.map((x) => x.scope)).toEqual(["personal"]);
  });

  it("leaves fresh sets alone and refreshes week-old ones", () => {
    const t = pickDueTargets({
      grantedUserIds: everyone,
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
      grantedUserIds: everyone,
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

  describe("full access", () => {
    it("makes personal sets only for granted people", () => {
      const t = pickDueTargets({ grantedUserIds: new Set(["carol"]), activeUserIds: new Set(["alice", "carol"]), memberships, lastSets: [], now: NOW });
      expect(t.filter((x) => x.scope === "personal").map((x) => x.userId)).toEqual(["carol"]);
    });

    it("makes a shared set only for a library with a granted member, even when the active member is not the granted one", () => {
      // Bob is granted, Alice (active) is not: L1 still gets a shared set, but only Bob could get a personal one.
      const t = pickDueTargets({ grantedUserIds: new Set(["bob"]), activeUserIds: new Set(["alice"]), memberships, lastSets: [], now: NOW });
      expect(t.map((x) => `${x.scope}:${x.libraryId}:${x.userId ?? "-"}`)).toEqual(["shared:L1:-"]);
    });

    it("skips a library whose members are all ungranted, and does nothing when nobody is granted", () => {
      const only = pickDueTargets({ grantedUserIds: new Set(["carol"]), activeUserIds: new Set(["dave", "erin"]), memberships, lastSets: [], now: NOW });
      expect(only).toEqual([]);
      const none = pickDueTargets({ grantedUserIds: new Set(), activeUserIds: new Set(["alice", "bob", "carol"]), memberships, lastSets: [], now: NOW });
      expect(none).toEqual([]);
    });
  });
});
