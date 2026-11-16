import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EmptyState, PageHeader, SpineRow } from "@/components/shelf";
import { LoanTag } from "@/components/loan-badge";
import { canEdit } from "@/lib/books/access";
import { getLibraryContext } from "@/lib/library";
import { loadBorrowers, loadLibraryLoans, type LoanWithBook } from "@/lib/loans/data";
import { activeLoans } from "@/lib/loans/rules";
import { formatDate } from "@/lib/regions";
import { BorrowerAdd, BorrowerDelete } from "./borrower-controls";

export const metadata: Metadata = { title: "Borrowers" };

export default async function BorrowersPage() {
  const { current, locale } = await getLibraryContext();
  if (!current) return null; // The layout shows the create-library prompt.
  const editor = canEdit(current.role);
  const [borrowers, loans] = await Promise.all([loadBorrowers(current.id), loadLibraryLoans(current.id)]);
  const now = new Date();
  const live = new Map(activeLoans(loans, now).map((l) => [l.id, l]));
  const byBorrower = new Map<string, LoanWithBook[]>();
  for (const l of loans) byBorrower.set(l.borrowerId, [...(byBorrower.get(l.borrowerId) ?? []), l]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Link href="/settings" className="-ml-2 flex h-11 w-fit items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Settings
      </Link>
      <PageHeader eyebrow={current.name} title="Borrowers" lede="Who has your books, and who lent you theirs." />

      {editor && <BorrowerAdd libraryId={current.id} />}

      {borrowers.length === 0 ? (
        <EmptyState
          title="Nobody on the list yet"
          body="Lend a copy from a book's page and the person is added here, with everything they have had from you."
          art={<SpineRow gap={5} spines={[{ w: 24, h: 92, tone: 2 }, { w: 20, h: 76, tone: 5 }, { w: 28, h: 104, tone: 1 }, { w: 22, h: 84, tone: 4 }]} />}
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {borrowers.map((b, i) => {
            const theirs = byBorrower.get(b.id) ?? [];
            const out = theirs.filter((l) => !l.returnedAt);
            const past = theirs.filter((l) => l.returnedAt);
            return (
              <li key={b.id} className="rise panel flex flex-col gap-3 p-4 md:p-5" style={{ ["--i" as string]: Math.min(i, 6) }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-xl leading-snug font-medium">{b.name}</h2>
                    {b.note && <p className="text-sm text-muted-foreground">{b.note}</p>}
                  </div>
                  {editor && theirs.length === 0 && <BorrowerDelete borrowerId={b.id} name={b.name} />}
                </div>

                <section aria-label={`${b.name}: out now`} className="flex flex-col gap-1">
                  <h3 className="eyebrow">Out now</h3>
                  {out.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing right now.</p>
                  ) : (
                    <ul className="flex flex-col divide-y divide-border">
                      {out.map((l) => (
                        <LoanRow key={l.id} loan={l} live={live.get(l.id)} locale={locale} />
                      ))}
                    </ul>
                  )}
                </section>

                {past.length > 0 && (
                  <details>
                    <summary className="flex h-11 cursor-pointer items-center text-sm text-muted-foreground hover:text-foreground">Past loans ({past.length})</summary>
                    <ul className="flex flex-col divide-y divide-border">
                      {past.map((l) => (
                        <LoanRow key={l.id} loan={l} locale={locale} />
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function LoanRow({ loan, live, locale }: { loan: LoanWithBook; live?: ReturnType<typeof activeLoans>[number]; locale: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
      <Link href={`/books/${loan.bookId}`} className="min-w-0 truncate text-[0.9375rem] font-medium underline-offset-4 hover:underline hover:decoration-gilt">
        {loan.bookTitle}
      </Link>
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        {live && <LoanTag loan={live} />}
        <span>{loan.direction === "out" ? "lent" : "borrowed"} {formatDate(loan.loanedAt, locale)}</span>
        {loan.returnedAt ? <span>· back {formatDate(loan.returnedAt, locale)}</span> : loan.dueAt ? <span>· due {formatDate(loan.dueAt, locale)}</span> : null}
      </span>
    </li>
  );
}
