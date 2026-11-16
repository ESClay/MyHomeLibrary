import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shelf";
import { canEdit } from "@/lib/books/access";
import { loadActiveImport } from "@/lib/calibre/jobs";
import { getLibraryContext } from "@/lib/library";
import { ImportScreen } from "./import-screen";

export const metadata: Metadata = { title: "Import from Calibre" };
/** Each batch is a server action on this page and stays well under this (see lib/calibre/limits.ts). */
export const maxDuration = 60;

export default async function Page() {
  const { current, user } = await getLibraryContext();
  if (!current) return null; // The layout shows the create-library prompt.

  if (!canEdit(current.role)) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <PageHeader eyebrow="New arrivals" title="Import from Calibre" />
        <p className="panel p-5 text-base">
          You have view-only access to {current.name}. Ask an owner to make you an editor if you want to import books.
        </p>
      </div>
    );
  }

  const resume = await loadActiveImport(current.id, user.id);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/add"
        className="-ml-2 inline-flex min-h-11 w-fit items-center gap-2 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> Back to Add a book
      </Link>
      <ImportScreen libraryId={current.id} libraryName={current.name} resume={resume} />
    </div>
  );
}
