import { isPhysicalFormat } from "@/lib/pricing/compute";

/** Loan rules shared by the server actions, the list filters and the badges. Pure: the clock is passed in. */

export type LoanDirection = "out" | "in";

/** One loan as the UI needs it. */
export type LoanLite = {
  id: string;
  direction: LoanDirection;
  copyId: string | null;
  bookId: string;
  borrowerId: string;
  borrowerName: string;
  loanedAt: string;
  dueAt: string | null;
  returnedAt: string | null;
};

/** What a badge shows. `overdue` is decided on the server and travels with the loan. */
export type ActiveLoan = Pick<LoanLite, "id" | "direction" | "borrowerName" | "dueAt"> & { overdue: boolean };

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * A loan is overdue once its due day has passed and it has not come back. The due day itself is not overdue, and a loan
 * without a due date never is. Days are compared in UTC so the answer is the same for the server and the browser.
 */
export function isOverdue(loan: { dueAt: string | null; returnedAt: string | null }, now: Date): boolean {
  if (loan.returnedAt || !loan.dueAt) return false;
  const due = new Date(loan.dueAt);
  if (Number.isNaN(due.getTime())) return false;
  return utcDay(now) > utcDay(due);
}

export const isActive = (loan: { returnedAt: string | null }) => loan.returnedAt === null;

/** Days between two moments, rounded down, never negative. */
export function daysOverdue(dueAt: string, now: Date): number {
  const ms = Date.parse(`${utcDay(now)}T00:00:00Z`) - Date.parse(`${dueAt.slice(0, 10)}T00:00:00Z`);
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** `2026-12-01` becomes the timestamp we store. Anything else is rejected, never guessed. */
export function dueDateToTimestamp(date: string | null | undefined): string | null | "invalid" {
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return "invalid";
  return `${date}T00:00:00Z`;
}

/** The loans still out, most urgent first: overdue, then the earliest due date, then those with no date. */
export function activeLoans(loans: LoanLite[], now: Date): (LoanLite & { overdue: boolean })[] {
  return loans
    .filter(isActive)
    .map((l) => ({ ...l, overdue: isOverdue(l, now) }))
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      if (a.dueAt && b.dueAt) return a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0;
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      return 0;
    });
}

/** The one loan a cover or row should show a badge for. */
export function primaryLoan(loans: ActiveLoan[]): ActiveLoan | null {
  if (loans.length === 0) return null;
  return (
    [...loans].sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      if (a.dueAt && b.dueAt) return a.dueAt < b.dueAt ? -1 : 1;
      return a.dueAt ? -1 : b.dueAt ? 1 : 0;
    })[0] ?? null
  );
}

/** Mirrors the partial unique index: at most one active lend per copy. */
export function hasActiveOutLoan(loans: Pick<LoanLite, "direction" | "copyId" | "returnedAt">[], copyId: string): boolean {
  return loans.some((l) => l.direction === "out" && l.copyId === copyId && l.returnedAt === null);
}

/** Mirrors the partial unique index: at most one active borrow per book. */
export function hasActiveInLoan(loans: Pick<LoanLite, "direction" | "bookId" | "returnedAt">[], bookId: string): boolean {
  return loans.some((l) => l.direction === "in" && l.bookId === bookId && l.returnedAt === null);
}

/** Why a copy cannot be lent right now, or null when it can. */
export function lendBlocker(copy: { id: string; format: string }, loans: Pick<LoanLite, "direction" | "copyId" | "returnedAt">[]): string | null {
  if (!isPhysicalFormat(copy.format)) return "Only physical copies can be lent.";
  if (hasActiveOutLoan(loans, copy.id)) return "This copy is already on loan.";
  return null;
}

/** Why a book cannot be recorded as borrowed, or null. A loan in needs a book we do not own, and only one at a time. */
export function borrowBlocker(book: { id: string; ownership: string }, loans: Pick<LoanLite, "direction" | "bookId" | "returnedAt">[]): string | null {
  if (book.ownership !== "borrowed") return "Only a borrowed book can have a loan in.";
  if (hasActiveInLoan(loans, book.id)) return "This book is already recorded as borrowed.";
  return null;
}

/** The text on a badge. */
export function loanBadgeText(loan: ActiveLoan): { label: "Overdue" | "On loan" | "Borrowed"; detail: string } {
  const who = loan.borrowerName;
  const label = loan.overdue ? "Overdue" : loan.direction === "out" ? "On loan" : "Borrowed";
  const detail = loan.direction === "out" ? `with ${who}` : `from ${who}`;
  return { label, detail };
}
