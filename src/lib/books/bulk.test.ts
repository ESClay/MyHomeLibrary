import { describe, expect, it } from "vitest";
import { classifyRefresh, copyResultMessage, emptyTally, markedReadMessage, planCopyChanges, refreshSummary } from "./bulk";

const book = (id: string, ownership: "owned" | "wishlist" | "borrowed" = "owned") => ({ id, ownership, isbn13: null });

describe("planCopyChanges", () => {
  it("updates one copy, adds to owned books with none, skips the rest", () => {
    const plan = planCopyChanges(
      [book("a"), book("b"), book("c"), book("d", "wishlist"), book("e", "borrowed")],
      [
        { id: "c1", book_id: "a" },
        { id: "c2", book_id: "c" },
        { id: "c3", book_id: "c" },
      ],
    );
    expect(plan.update).toEqual(["c1"]);
    expect(plan.create.map((b) => b.id)).toEqual(["b"]);
    expect(plan.skippedMultiCopy).toBe(1);
    expect(plan.skippedNoCopy).toBe(2);
  });
});

describe("copyResultMessage", () => {
  it("names the skips", () => {
    expect(copyResultMessage({ updated: 8, created: 1, skippedMultiCopy: 2, skippedNoCopy: 0 })).toBe("Updated 9 books. Skipped 2 with more than one copy.");
    expect(copyResultMessage({ updated: 0, created: 0, skippedMultiCopy: 0, skippedNoCopy: 1 })).toContain("No books changed.");
  });
});

describe("classifyRefresh", () => {
  it("sorts the refreshMetadata answers", () => {
    expect(classifyRefresh({ ok: true, outcome: "updated" })).toBe("updated");
    expect(classifyRefresh({ ok: true, outcome: "upToDate" })).toBe("upToDate");
    expect(classifyRefresh({ ok: false, code: "no_match" })).toBe("noMatch");
    expect(classifyRefresh({ ok: false, code: "full_access_required" })).toBe("denied");
    expect(classifyRefresh({ ok: false })).toBe("failed");
  });
});

describe("refreshSummary", () => {
  it("summarises and notes a stop", () => {
    expect(refreshSummary({ ...emptyTally(), updated: 14, upToDate: 4, noMatch: 2 })).toBe("Updated 14, already up to date 4, no match 2.");
    expect(refreshSummary({ ...emptyTally(), noMatch: 1 }, { stopped: true })).toBe("No match 1. Stopped early.");
    expect(refreshSummary(emptyTally(), { denied: "Full access needed." })).toBe("Nothing changed. Stopped: Full access needed.");
  });
});

describe("markedReadMessage", () => {
  it("is singular for one book", () => {
    expect(markedReadMessage(1)).toBe("Marked 1 book as read.");
    expect(markedReadMessage(12)).toBe("Marked 12 books as read.");
  });
});
