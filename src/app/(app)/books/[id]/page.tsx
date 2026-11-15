import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Cover } from "@/components/cover";
import { Badge } from "@/components/ui/badge";
import { Stars } from "@/components/stars";
import { canEdit } from "@/lib/books/access";
import { OWNERSHIP_LABEL, RATING_SOURCE_LABEL, STATUS_LABEL } from "@/lib/books/constants";
import { loadBookDetail } from "@/lib/books/data";
import { timesRead } from "@/lib/format";
import { getLibraryContext } from "@/lib/library";
import { BookActions, DeleteBook } from "./book-actions";
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

  const { user } = await getLibraryContext();
  const detail = await loadBookDetail(id, user.id);
  if (!detail) notFound();

  const { book, copies, me, others, role } = detail;
  const editor = canEdit(role);
  const finishedCount = (reads: typeof me.reads) => reads.filter((r) => r.finished_at).length;
  const source = book.rating_source ? (RATING_SOURCE_LABEL[book.rating_source] ?? book.rating_source) : null;

  return (
    <article className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <Link
        href="/library"
        className="-ml-2 flex h-11 w-fit items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Library
      </Link>

      <header className="rise grid gap-6 md:grid-cols-[13rem_1fr] md:gap-10">
        <div className="mx-auto flex w-44 flex-col gap-0 md:mx-0 md:w-full">
          <Cover url={book.cover_url} title={book.title} author={book.authors[0]} priority />
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
            <p className="text-base">{book.authors.join(", ") || "Unknown author"}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={book.ownership === "owned" ? "default" : "secondary"}>{OWNERSHIP_LABEL[book.ownership]}</Badge>
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

          {editor && <BookActions book={book} />}
        </div>
      </header>

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

      <Section title="Copies" eyebrow={copies.length === 1 ? "1 copy" : `${copies.length} copies`}>
        <CopiesSection bookId={book.id} copies={copies} canEdit={editor} />
      </Section>

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

function Section({ title, eyebrow, children }: { title: string; eyebrow?: string; children: React.ReactNode }) {
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
