import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Locked } from "@/components/locked";
import { PageHeader } from "@/components/shelf";
import { hasFullAccess } from "@/lib/access";
import { canEdit } from "@/lib/books/access";
import { getLibraryContext } from "@/lib/library";
import { loadPhotoBatch } from "@/lib/scan/batch-queries";
import { dailyScanStatus } from "@/lib/scan/jobs";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { BatchScreen } from "./batch-screen";
import { PhotoScreen } from "./photo-screen";

export const metadata: Metadata = { title: "Photograph covers" };

export default async function Page({ searchParams }: { searchParams: Promise<{ batch?: string; queued?: string }> }) {
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

  const supabase = await createClient();
  if (!(await hasFullAccess(supabase, user.id))) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Link
          href="/add"
          className="-ml-2 inline-flex min-h-11 w-fit items-center gap-2 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" /> Back to Add a book
        </Link>
        <PageHeader eyebrow="New arrivals" title="Photograph covers" />
        <Locked />
      </div>
    );
  }

  const sp = await searchParams;
  const batchId = z.string().uuid().safeParse(sp.batch);
  if (batchId.success) {
    const batch = await loadPhotoBatch(supabase, current.id, batchId.data);
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div className="flex flex-col gap-4">
          <Link
            href="/add/photo"
            className="-ml-2 inline-flex min-h-11 w-fit items-center gap-2 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft aria-hidden className="size-4" /> Back to Photograph covers
          </Link>
          <PageHeader eyebrow="New arrivals" title="Photo batch" lede="Each photo is read in the background. Review the books it found before anything is saved." />
        </div>
        {batch ? (
          <BatchScreen
            libraryId={current.id}
            batch={{
              jobId: batch.job.id,
              active: batch.job.status === "queued" || batch.job.status === "running",
              finished: batch.job.status === "done" || batch.job.status === "failed",
              cancelled: batch.job.status === "cancelled",
              total: batch.job.total,
              processed: batch.job.processed,
              queuedJustNow: sp.queued === "1",
              photos: batch.photos,
            }}
          />
        ) : (
          <p className="panel p-5 text-base">That batch could not be found. It may belong to another library, or it was cleared.</p>
        )}
      </div>
    );
  }

  const cap = await dailyScanStatus(supabase, user.id);

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
          lede={`Photograph covers, a stack or a shelf of spines, up to 12 photos in one go. They are read in the background. You confirm every book before anything lands in ${current.name}.`}
        />
      </div>
      <PhotoScreen libraryId={current.id} userId={user.id} initialRemaining={cap.remaining} cap={cap.cap} />
    </div>
  );
}
