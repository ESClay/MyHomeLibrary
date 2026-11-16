"use client";

import { useLocale } from "@/components/locale-provider";
import { loanBadgeText, type ActiveLoan } from "@/lib/loans/rules";
import { formatDate } from "@/lib/regions";
import { cn } from "@/lib/utils";

const TONE = {
  Overdue: "bg-destructive text-background",
  "On loan": "bg-foreground text-background",
  Borrowed: "bg-gilt text-background",
} as const;

/** "On loan", "Overdue" or "Borrowed" as a small tag. Text carries the meaning, so colour is never the only signal. */
export function LoanTag({ loan, className }: { loan: ActiveLoan; className?: string }) {
  const { label, detail } = loanBadgeText(loan);
  return (
    <span
      title={`${label} ${detail}`}
      className={cn("inline-flex h-5 items-center rounded-[3px] px-1.5 text-[0.625rem] font-semibold tracking-wider whitespace-nowrap uppercase", TONE[label], className)}
    >
      {label}
    </span>
  );
}

/** The same tag floated over a cover's bottom-left corner. */
export function CoverLoanTag({ loan }: { loan: ActiveLoan }) {
  return <LoanTag loan={loan} className="absolute bottom-1.5 left-1.5 shadow-sm" />;
}

/** "with Sam · due 3 Dec 2026", for under a title. */
export function LoanLine({ loan, className }: { loan: ActiveLoan; className?: string }) {
  const locale = useLocale();
  const { detail } = loanBadgeText(loan);
  return (
    <span className={cn("truncate text-xs text-muted-foreground", loan.overdue && "text-destructive", className)}>
      {detail}
      {loan.dueAt ? ` · due ${formatDate(loan.dueAt, locale)}` : ""}
    </span>
  );
}
