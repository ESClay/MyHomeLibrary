import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shelf";
import { canEdit } from "@/lib/books/access";
import { getLibraryContext } from "@/lib/library";
import { ScanLoader } from "./scan-loader";

export const metadata: Metadata = { title: "Scan books" };

export default async function Page() {
  const { current } = await getLibraryContext();
  if (!current) return null; // The layout shows the create-library prompt.

  if (!canEdit(current.role)) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <PageHeader eyebrow="New arrivals" title="Scan books" />
        <p className="panel p-5 text-base">
          You have view-only access to {current.name}. Ask an owner to make you an editor if you want to add books.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="hidden flex-col gap-4 md:flex">
        <Link
          href="/add"
          className="-ml-2 inline-flex min-h-11 w-fit items-center gap-2 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" /> Back to Add a book
        </Link>
        <PageHeader eyebrow="New arrivals" title="Scan books" lede={`Hold each barcode up to the camera, or type the ISBN. Books collect in the tray, then land in ${current.name} when you save.`} />
      </div>
      <ScanLoader libraryId={current.id} />
    </div>
  );
}
