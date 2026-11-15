import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shelf";
import { canEdit } from "@/lib/books/access";
import { getLibraryContext } from "@/lib/library";
import { dailyScanStatus } from "@/lib/scan/jobs";
import { createClient } from "@/lib/supabase/server";
import { PhotoScreen } from "./photo-screen";

export const metadata: Metadata = { title: "Photograph covers" };

export default async function Page() {
  const { current, user } = await getLibraryContext();
  if (!current) return null; // The layout shows the create-library prompt.

  if (!canEdit(current.role)) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <PageHeader eyebrow="New arrivals" title="Photograph covers" />
        <p className="panel p-5 text-base">
          You have view-only access to {current.name}. Ask an owner to make you an editor if you want to add books.
        </p>
      </div>
    );
  }

  const cap = await dailyScanStatus(await createClient(), user.id);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href="/add"
          className="-ml-2 inline-flex min-h-11 w-fit items-center gap-2 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" /> Back to Add a book
        </Link>
        <PageHeader
          eyebrow="New arrivals"
          title="Photograph covers"
          lede={`Photograph one cover, a stack or a shelf of spines. You confirm every book before anything lands in ${current.name}.`}
        />
      </div>
      <PhotoScreen libraryId={current.id} userId={user.id} initialRemaining={cap.remaining} cap={cap.cap} />
    </div>
  );
}
