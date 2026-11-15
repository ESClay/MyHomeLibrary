import type { Metadata } from "next";
import Link from "next/link";
import { Camera, ChevronRight, ScanBarcode } from "lucide-react";
import { PageHeader } from "@/components/shelf";
import { canEdit } from "@/lib/books/access";
import { getLibraryContext } from "@/lib/library";
import { AddBook } from "./add-book";

export const metadata: Metadata = { title: "Add a book" };

export default async function Page({ searchParams }: { searchParams: Promise<{ isbn?: string }> }) {
  const { isbn } = await searchParams;
  const manualIsbn = isbn && /^\d{13}$/.test(isbn) ? isbn : null;
  const { current } = await getLibraryContext();
  if (!current) return null; // The layout shows the create-library prompt.
  const editor = canEdit(current.role);

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
          </div>
          <AddBook libraryId={current.id} manualIsbn={manualIsbn} />
        </>
      ) : (
        <p className="panel p-5 text-base">
          You have view-only access to {current.name}. Ask an owner to make you an editor if you want to add books.
        </p>
      )}
    </div>
  );
}
