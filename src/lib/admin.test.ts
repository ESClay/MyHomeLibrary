import { describe, expect, it } from "vitest";
import { filterAccounts, toAccount, type AdminAccount } from "./admin";

const account = (over: Partial<AdminAccount>): AdminAccount => ({
  userId: "u",
  displayName: null,
  email: null,
  createdAt: "2026-11-01T00:00:00Z",
  fullAccess: false,
  isAdmin: false,
  libraryCount: 0,
  ...over,
});

const list = [
  account({ userId: "1", displayName: "Amélie Durand", email: "amelie@example.com" }),
  account({ userId: "2", displayName: "Sam Reader", email: "sam.reader@example.org", fullAccess: true }),
  account({ userId: "3", displayName: null, email: "pat@example.com" }),
];

describe("filterAccounts", () => {
  it("returns everything for an empty search", () => {
    expect(filterAccounts(list, "  ")).toHaveLength(3);
  });
  it("matches name or email, ignoring case and accents", () => {
    expect(filterAccounts(list, "amelie").map((a) => a.userId)).toEqual(["1"]);
    expect(filterAccounts(list, "DURAND").map((a) => a.userId)).toEqual(["1"]);
    expect(filterAccounts(list, "example.org").map((a) => a.userId)).toEqual(["2"]);
  });
  it("needs every word to match", () => {
    expect(filterAccounts(list, "sam reader").map((a) => a.userId)).toEqual(["2"]);
    expect(filterAccounts(list, "sam durand")).toEqual([]);
  });
});

describe("toAccount", () => {
  it("maps a row of admin_list_accounts", () => {
    expect(toAccount({ user_id: "x", display_name: "N", email: "e", created_at: "t", full_access: true, is_admin: true, library_count: "2" })).toEqual({
      userId: "x",
      displayName: "N",
      email: "e",
      createdAt: "t",
      fullAccess: true,
      isAdmin: true,
      libraryCount: 2,
    });
  });
});
