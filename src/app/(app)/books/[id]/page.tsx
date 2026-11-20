import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "./back-link";
import { Avatar } from "@/components/avatar";
import { Cover } from "@/components/cover";
import { Badge } from "@/components/ui/badge";
import { Stars } from "@/components/stars";
import { hasFullAccess } from "@/lib/access";
import { canEdit } from "@/lib/books/access";
import { OWNERSHIP_LABEL, RATING_SOURCE_LABEL, STATUS_LABEL } from "@/lib/books/constants";
import { loadAuthorVariants, loadBookDetail, loadSeriesOptions } from "@/lib/books/data";
import { LoanLine, LoanTag } from "@/components/loan-badge";
import { timesRead } from "@/lib/format";
import { activeLoans } from "@/lib/loans/rules";
import { loadBorrowers } from "@/lib/loans/data";
import { formatDate } from "@/lib/regions";
import { getLibraryContext } from "@/lib/library";
import { createClient } from "@/lib/supabase/server";
import { loadShelvesForBook } from "@/lib/shelves/data";
import { canChangeShelfBooks } from "@/lib/shelves/permissions";
import { AuthorLine } from "./author-line";
import { BookActions, DeleteBook } from "./book-actions";
import { BookShelves } from "./book-shelves";
import { BorrowedReturn } from "./borrowed-return";
import { CopiesSection } from "./copies-section";
import { Description } from "./description";
import { MyShelf, OtherRating } from "./my-shelf";

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: UUID.test(id) ? "Book" : "Not found" };
}

export default async function BookPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const { user, locale, currency } = await getLibraryContext();
  const [detail, bookShelves, fullAccess] = await Promise.all([loadBookDetail(id, user.id), loadShelvesForBook(id), hasFullAccess(await createClient(), user.id)]);
  if (!detail) notFound();

  const { book, copies, me, others, role, loans, priceHistory, priceRegion } = detail;
  const [borrowers, seriesOptions, authorGroups] = canEdit(role)
    ? await Promise.all([loadBorrowers(book.library_id), loadSeriesOptions(book.library_id), loadAuthorVariants(book.library_id)])
    : [[], [], []];
  const now = new Date();
  const active = activeLoans(loans, now);
  const borrowedLoan = book.ownership === "borrowed" ? (active.find((l) => l.direction === "in") ?? null) : null;
  const history = loans;
  const editor = canEdit(role);
  const finishedCount = (reads: typeof me.reads) => reads.filter((r) => r.finished_at).length;
  const source = book.rating_source ? (RATING_SOURCE_LABEL[book.rating_source] ?? book.rating_source) : null;

  return (
    <article className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <BackLink />

      <header className="rise grid gap-6 md:grid-cols-[13rem_1fr] md:gap-10">
        <div className="mx-auto flex w-44 flex-col gap-0 md:mx-0 md:w-full">
          <Cover url={book.cover_url} title={book.title} author={book.authors[0]} priority sizes="(min-width: 768px) 208px, 176px" />
          <div className="shelf-line -mx-3 mt-0" aria-hidden />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-2">
            {book.series_name && (
              <p className="eyebrow text-gilt">
                {book.series_name}
                {book.series_position !== null ? ` · Book ${book.series_position}` : ""}
              </p>
            )}
            <h1 className="page-title">{book.title}</h1>
            {book.subtitle && <p className="font-display text-xl text-muted-foreground">{book.subtitle}</p>}
            <AuthorLine authors={book.authors} libraryId={book.library_id} canEdit={canEdit(role)} groups={authorGroups} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={book.ownership === "owned" ? "default" : "secondary"}>{OWNERSHIP_LABEL[book.ownership]}</Badge>
            {active.length > 0 && <LoanTag loan={active[0]} />}
            {book.page_count && <Badge variant="outline">{book.page_count} pages</Badge>}
            {book.published_date && <Badge variant="outline">{book.published_date.slice(0, 4)}</Badge>}
            {book.genres.slice(0, 3).map((g) => (
              <Badge key={g} variant="outline">
                {g}
              </Badge>
            ))}
          </div>

          {book.public_rating !== null && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Stars value={Math.round(book.public_rating * 2) / 2} size={18} label={`Public rating ${book.public_rating.toFixed(1)} out of 5`} />
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground tabular-nums">{book.public_rating.toFixed(1)}</span>
                {source ? ` on ${source}` : ""}
                {book.public_rating_count ? ` · ${book.public_rating_count.toLocaleString("en")} ratings` : ""}
              </p>
            </div>
          )}

          {active.length > 0 && (
            <p className="flex flex-col text-sm">
              {active.map((l) => (
                <LoanLine key={l.id} loan={l} className="whitespace-normal" />
              ))}
            </p>
          )}

          {editor && borrowedLoan && <BorrowedReturn bookId={book.id} title={book.title} />}

          {editor && <BookActions book={book} seriesOptions={seriesOptions} />}
        </div>
      </header>

      <Section title="On shelves" eyebrow="Rooms and rows">
        <BookShelves
          bookId={book.id}
          libraryId={book.library_id}
          shelves={bookShelves
            .filter((s) => s.kind === "manual")
            .map((s) => ({
              id: s.id,
              name: s.name,
              color: s.color,
              icon: s.icon,
              private: s.visibility === "private",
              removable: canChangeShelfBooks(role, user.id, s),
            }))}
        />
      </Section>

      <Section title="Your shelf" eyebrow="Just yours to edit">
        <MyShelf bookId={book.id} status={me.status} rating={me.rating} notes={me.notes} reads={me.reads} />
      </Section>

      {others.length > 0 && (
        <Section title={others.length === 1 ? `${others[0].name}'s shelf` : "Everyone else"} eyebrow="Read only">
          <ul className="grid gap-4 md:grid-cols-2">
            {others.map((o) => (
              <li key={o.userId} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={o.name} url={o.avatarUrl} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{o.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {o.status ? STATUS_LABEL[o.status] : "No status yet"}
                      {finishedCount(o.reads) > 0 ? ` · ${timesRead(finishedCount(o.reads))}` : ""}
                    </p>
                  </div>
                </div>
                <OtherRating rating={o.rating} />
                {o.notes ? (
                  <p className="border-l-2 border-gilt pl-3 text-[0.9375rem] leading-relaxed whitespace-pre-line">{o.notes}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">No notes.</p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {book.ownership !== "borrowed" && (
        <Section title="Copies" eyebrow={copies.length === 1 ? "1 copy" : `${copies.length} copies`}>
          <CopiesSection
            bookId={book.id}
            copies={copies}
            canEdit={editor}
            loans={loans}
            history={priceHistory}
            borrowers={borrowers.map((b) => ({ id: b.id, name: b.name }))}
            currency={currency}
            priceRegion={priceRegion}
            fullAccess={fullAccess}
            nowIso={now.toISOString()}
          />
        </Section>
      )}

      {history.length > 0 && (
        <Section title="Lending history" eyebrow={<Link href="/borrowers" className="underline decoration-gilt underline-offset-4">All borrowers</Link>}>
          <ul className="flex flex-col divide-y divide-border">
            {history.map((l) => {
              const live = active.find((a) => a.id === l.id);
              return (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-[0.9375rem]">
                  <span>
                    {l.direction === "out" ? "Lent to" : "Borrowed from"} <strong className="font-semibold">{l.borrowerName}</strong>
                  </span>
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    {live && <LoanTag loan={live} />}
                    {formatDate(l.loanedAt, locale)}
                    {l.returnedAt ? ` to ${formatDate(l.returnedAt, locale)}` : l.dueAt ? `, due ${formatDate(l.dueAt, locale)}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {(book.description || book.isbn13) && (
        <Section title="About this book">
          <div className="flex flex-col gap-5">
            {book.description && <Description text={book.description} />}
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
              {book.isbn13 && (
                <>
                  <dt className="text-muted-foreground">ISBN-13</dt>
                  <dd className="tabular-nums">{book.isbn13}</dd>
                </>
              )}
              {book.published_date && (
                <>
                  <dt className="text-muted-foreground">Published</dt>
                  <dd>{book.published_date}</dd>
                </>
              )}
              {book.genres.length > 0 && (
                <>
                  <dt className="text-muted-foreground">Genres</dt>
                  <dd>{book.genres.join(", ")}</dd>
                </>
              )}
            </dl>
          </div>
        </Section>
      )}

      {editor && (
        <Section title="Remove from library">
          <DeleteBook bookId={book.id} title={book.title} />
        </Section>
      )}
    </article>
  );
}

function Section({ title, eyebrow, children }: { title: string; eyebrow?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rise panel flex flex-col gap-5 p-5 md:p-7" style={{ ["--i" as string]: 1 }}>
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-2xl leading-tight font-medium">{title}</h2>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      </header>
      {children}
    </section>
  );
}
