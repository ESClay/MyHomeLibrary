import { describe, expect, it } from "vitest";
import {
  activeLoans,
  borrowBlocker,
  daysOverdue,
  dueDateToTimestamp,
  hasActiveInLoan,
  hasActiveOutLoan,
  isOverdue,
  lendBlocker,
  loanBadgeText,
  primaryLoan,
  type LoanLite,
} from "./rules";

const NOW = new Date("2026-11-20T15:00:00Z");
const loan = (over: Partial<LoanLite> = {}): LoanLite => ({
  id: "l1",
  direction: "out",
  copyId: "c1",
  bookId: "b1",
  borrowerId: "p1",
  borrowerName: "Sam",
  loanedAt: "2026-11-01T00:00:00Z",
  dueAt: null,
  returnedAt: null,
  ...over,
});

describe("isOverdue", () => {
  it("is overdue only after the due day has passed", () => {
    expect(isOverdue({ dueAt: "2026-11-19T00:00:00Z", returnedAt: null }, NOW)).toBe(true);
    expect(isOverdue({ dueAt: "2026-11-20T00:00:00Z", returnedAt: null }, NOW)).toBe(false);
    expect(isOverdue({ dueAt: "2026-11-21T00:00:00Z", returnedAt: null }, NOW)).toBe(false);
  });

  it("is never overdue without a due date or once returned", () => {
    expect(isOverdue({ dueAt: null, returnedAt: null }, NOW)).toBe(false);
    expect(isOverdue({ dueAt: "2026-01-01T00:00:00Z", returnedAt: "2026-02-01T00:00:00Z" }, NOW)).toBe(false);
    expect(isOverdue({ dueAt: "not a date", returnedAt: null }, NOW)).toBe(false);
  });

  it("counts days overdue", () => {
    expect(daysOverdue("2026-11-17T00:00:00Z", NOW)).toBe(3);
    expect(daysOverdue("2026-11-25T00:00:00Z", NOW)).toBe(0);
  });
});

describe("due dates", () => {
  it("turns a date into a timestamp and rejects anything else", () => {
    expect(dueDateToTimestamp("2026-12-01")).toBe("2026-12-01T00:00:00Z");
    expect(dueDateToTimestamp("")).toBeNull();
    expect(dueDateToTimestamp(null)).toBeNull();
    expect(dueDateToTimestamp("12/01/2026")).toBe("invalid");
    expect(dueDateToTimestamp("2026-13-45")).toBe("invalid");
  });
});

describe("active loans", () => {
  it("drops returned loans and puts overdue first, then the earliest due date, then undated", () => {
    const list = activeLoans(
      [
        loan({ id: "undated" }),
        loan({ id: "later", dueAt: "2026-12-30T00:00:00Z" }),
        loan({ id: "returned", dueAt: "2026-01-01T00:00:00Z", returnedAt: "2026-01-05T00:00:00Z" }),
        loan({ id: "soon", dueAt: "2026-11-25T00:00:00Z" }),
        loan({ id: "late", dueAt: "2026-11-01T00:00:00Z" }),
      ],
      NOW,
    );
    expect(list.map((l) => l.id)).toEqual(["late", "soon", "later", "undated"]);
    expect(list[0].overdue).toBe(true);
    expect(list[1].overdue).toBe(false);
  });

  it("picks the loan a badge should show", () => {
    expect(primaryLoan([])).toBeNull();
    const a = { id: "a", direction: "out" as const, borrowerName: "A", dueAt: "2026-12-01T00:00:00Z", overdue: false };
    const b = { id: "b", direction: "out" as const, borrowerName: "B", dueAt: "2026-10-01T00:00:00Z", overdue: true };
    expect(primaryLoan([a, b])?.id).toBe("b");
  });
});

describe("one active loan", () => {
  const loans = [loan({ id: "x", copyId: "c1" }), loan({ id: "y", copyId: "c2", returnedAt: "2026-11-02T00:00:00Z" }), loan({ id: "z", direction: "in", copyId: null, bookId: "b9" })];

  it("allows one active lend per copy", () => {
    expect(hasActiveOutLoan(loans, "c1")).toBe(true);
    expect(hasActiveOutLoan(loans, "c2")).toBe(false); // that loan came back
    expect(hasActiveOutLoan(loans, "c3")).toBe(false);
  });

  it("allows one active borrow per book", () => {
    expect(hasActiveInLoan(loans, "b9")).toBe(true);
    expect(hasActiveInLoan(loans, "b1")).toBe(false);
  });

  it("explains why a copy cannot be lent", () => {
    expect(lendBlocker({ id: "c1", format: "paperback" }, loans)).toMatch(/already on loan/);
    expect(lendBlocker({ id: "c2", format: "hardcover" }, loans)).toBeNull();
    expect(lendBlocker({ id: "c3", format: "ebook" }, loans)).toMatch(/physical/);
  });

  it("needs a borrowed book for a loan in, and not twice", () => {
    expect(borrowBlocker({ id: "b1", ownership: "owned" }, [])).toMatch(/borrowed book/);
    expect(borrowBlocker({ id: "b1", ownership: "wishlist" }, [])).toMatch(/borrowed book/);
    expect(borrowBlocker({ id: "b1", ownership: "borrowed" }, [])).toBeNull();
    expect(borrowBlocker({ id: "b9", ownership: "borrowed" }, loans)).toMatch(/already/);
  });
});

describe("badge text", () => {
  it("names the borrower or the lender, and Overdue wins", () => {
    expect(loanBadgeText({ id: "1", direction: "out", borrowerName: "Sam", dueAt: null, overdue: false })).toEqual({ label: "On loan", detail: "with Sam" });
    expect(loanBadgeText({ id: "1", direction: "in", borrowerName: "Ana", dueAt: null, overdue: false })).toEqual({ label: "Borrowed", detail: "from Ana" });
    expect(loanBadgeText({ id: "1", direction: "in", borrowerName: "Ana", dueAt: "2026-01-01T00:00:00Z", overdue: true }).label).toBe("Overdue");
  });
});
