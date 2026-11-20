import type { Metadata } from "next";
import Link from "next/link";
import { Camera, ChevronRight, FileSpreadsheet, Lock, ScanBarcode } from "lucide-react";
import { LOCKED_SENTENCE } from "@/components/locked";
import { PageHeader } from "@/components/shelf";
import { hasFullAccess } from "@/lib/access";
import { canEdit } from "@/lib/books/access";
import { loadSeriesOptions } from "@/lib/books/data";
import { getLibraryContext } from "@/lib/library";
import { loadBorrowers } from "@/lib/loans/data";
import { createClient } from "@/lib/supabase/server";
import { AddBook } from "./add-book";

export const metadata: Metadata = { title: "Add a book" };

export default async function Page({ searchParams }: { searchParams: Promise<{ isbn?: string }> }) {
  const { isbn } = await searchParams;
  const manualIsbn = isbn && /^\d{13}$/.test(isbn) ? isbn : null;
  const { user, current, currency } = await getLibraryContext();
  if (!current) return null; // The layout shows the create-library prompt.
  const editor = canEdit(current.role);
  const [borrowers, seriesOptions, fullAccess] = await Promise.all([editor ? loadBorrowers(current.id) : Promise.resolve([]), editor ? loadSeriesOptions(current.id) : Promise.resolve([]), hasFullAccess(await createClient(), user.id)]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow="New arrivals"
        title="Add a book"
        lede={editor ? `Search by title, author or ISBN and it lands in ${current.name}.` : undefined}
      />

      {editor ? (
        <>
          <div className="flex flex-col gap-3">
            <Link
              href="/add/scan"
              className="rise panel group flex min-h-[4.5rem] items-center gap-4 p-4 transition-[transform,border-color] duration-[var(--dur-fast)] hover:-translate-y-0.5 hover:border-foreground/30 active:translate-y-px"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ScanBarcode className="size-5" strokeWidth={1.5} aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-lg leading-snug font-medium">Scan barcodes</span>
                <span className="text-sm text-muted-foreground">
                  Point the camera at the ISBN on the back, one book after another, then review the stack.
                </span>
              </span>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground transition-transform duration-[var(--dur-fast)] group-hover:translate-x-0.5" />
            </Link>
            {fullAccess ? (
              <Link
                href="/add/photo"
                className="rise panel group flex min-h-[4.5rem] items-center gap-4 p-4 transition-[transform,border-color] duration-[var(--dur-fast)] hover:-translate-y-0.5 hover:border-foreground/30 active:translate-y-px"
                style={{ ["--i" as string]: 1 }}
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Camera className="size-5" strokeWidth={1.5} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-lg leading-snug font-medium">Photograph covers</span>
                  <span className="text-sm text-muted-foreground">
                    Snap one cover, a stack or a shelf of spines, then confirm the books it recognises.
                  </span>
                </span>
                <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground transition-transform duration-[var(--dur-fast)] group-hover:translate-x-0.5" />
              </Link>
            ) : (
              <div
                data-locked="photo"
                aria-label="Photograph covers, full access needed"
                className="rise panel flex min-h-[4.5rem] items-center gap-4 border-dashed p-4"
                style={{ ["--i" as string]: 1 }}
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <Lock className="size-5" strokeWidth={1.5} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-lg leading-snug font-medium text-muted-foreground">Photograph covers</span>
                  <span className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Full access needed.</span> {LOCKED_SENTENCE}
                  </span>
                </span>
              </div>
            )}
            <Link
              href="/add/import"
              className="rise panel group flex min-h-[4.5rem] items-center gap-4 p-4 transition-[transform,border-color] duration-[var(--dur-fast)] hover:-translate-y-0.5 hover:border-foreground/30 active:translate-y-px"
              style={{ ["--i" as string]: 2 }}
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <FileSpreadsheet className="size-5" strokeWidth={1.5} aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-lg leading-snug font-medium">Import from Calibre</span>
                <span className="text-sm text-muted-foreground">
                  Upload a Calibre catalog CSV and bring your e-book library across in one go.
                </span>
              </span>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground transition-transform duration-[var(--dur-fast)] group-hover:translate-x-0.5" />
            </Link>
          </div>
          <AddBook libraryId={current.id} fullAccess={fullAccess} manualIsbn={manualIsbn} borrowers={borrowers.map((b) => ({ id: b.id, name: b.name }))} currency={currency} seriesOptions={seriesOptions} />
        </>
      ) : (
        <p className="panel p-5 text-base">
          You have view-only access to {current.name}. Ask an owner to make you an editor if you want to add books.
        </p>
      )}
    </div>
  );
}
