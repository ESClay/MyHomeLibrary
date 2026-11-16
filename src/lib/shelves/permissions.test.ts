import { describe, expect, it } from "vitest";
import { canChangeShelfBooks, canCreateShelf, canEditShelf, canSeeShelf, canWriteShelf, visibleShelves } from "./permissions";

const shared = { visibility: "shared", createdBy: "alice", kind: "manual" } as const;
const mine = { visibility: "private", createdBy: "carol", kind: "manual" } as const;

describe("shelf permissions mirror the RLS", () => {
  it("members see shared shelves; only the creator sees a private one", () => {
    expect(canSeeShelf("viewer", "carol", shared)).toBe(true);
    expect(canSeeShelf("editor", "bob", mine)).toBe(false);
    expect(canSeeShelf("owner", "alice", mine)).toBe(false);
    expect(canSeeShelf("viewer", "carol", mine)).toBe(true);
    expect(canSeeShelf(null, "eve", shared)).toBe(false);
  });
  it("any member can create a private shelf, only editors and owners a shared one", () => {
    expect(canCreateShelf("viewer", "private")).toBe(true);
    expect(canCreateShelf("viewer", "shared")).toBe(false);
    expect(canCreateShelf("editor", "shared")).toBe(true);
    expect(canCreateShelf("owner", "shared")).toBe(true);
    expect(canCreateShelf(null, "private")).toBe(false);
  });
  it("writes: editors on shared shelves, creators on private ones", () => {
    expect(canWriteShelf("editor", "bob", shared)).toBe(true);
    expect(canWriteShelf("viewer", "carol", shared)).toBe(false);
    expect(canWriteShelf("viewer", "carol", mine)).toBe(true);
    expect(canWriteShelf("owner", "alice", mine)).toBe(false);
  });
  it("a viewer cannot turn their private shelf shared, an editor can", () => {
    expect(canEditShelf("viewer", "carol", mine, "shared")).toBe(false);
    expect(canEditShelf("viewer", "carol", mine, "private")).toBe(true);
    expect(canEditShelf("editor", "bob", { visibility: "private", createdBy: "bob" }, "shared")).toBe(true);
    // An editor cannot take over someone else's shared shelf into a private one.
    expect(canEditShelf("editor", "bob", shared, "private")).toBe(false);
  });
  it("hand-made membership is for manual shelves only", () => {
    expect(canChangeShelfBooks("editor", "bob", { ...shared, kind: "smart" })).toBe(false);
    expect(canChangeShelfBooks("editor", "bob", shared)).toBe(true);
  });
  it("filters a list to what a person may see", () => {
    const all = [shared, mine, { visibility: "private", createdBy: "bob", kind: "manual" } as const];
    expect(visibleShelves("editor", "bob", all)).toHaveLength(2);
    expect(visibleShelves("viewer", "carol", all)).toHaveLength(2);
  });
});
