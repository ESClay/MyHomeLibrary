"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, ImagePlus, LoaderCircle } from "lucide-react";
import { MarkSeen } from "@/app/(app)/activity/activity-controls";
import { AutoRefresh } from "@/components/auto-refresh";
import { Button } from "@/components/ui/button";
import { PHOTO_STATE_LABEL, type PhotoRowState } from "@/lib/scan/batch";
import type { ScanItem } from "@/lib/scan/resolve";
import { PhotoReview } from "./photo-review";

export type BatchView = {
  jobId: string;
  active: boolean;
  /** "done" and "failed" jobs are finished and can be marked seen. */
  finished: boolean;
  cancelled: boolean;
  total: number;
  processed: number;
  queuedJustNow: boolean;
  photos: { id: string; number: number; state: PhotoRowState; error: string | null; items: ScanItem[] }[];
};

const link =
  "inline-flex h-11 shrink-0 items-center rounded-lg px-3 text-[0.9375rem] font-medium underline decoration-gilt decoration-2 underline-offset-4 transition-colors duration-[var(--dur-fast)] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px";

/** One photo batch: per-photo progress while it runs (refreshed every 10 s), then each finished photo opens in the review tray. */
export function BatchScreen({ libraryId, batch }: { libraryId: string; batch: BatchView }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = batch.photos.find((p) => p.id === openId && p.state === "ready") ?? null;

  async function discard(id: string, saved: boolean) {
    try {
      await fetch(`/api/scan/${id}/discard${saved ? "?saved=1" : ""}`, { method: "POST", keepalive: true });
    } catch {
      /* the sweep will get it */
    }
  }

  async function close(id: string, saved: boolean) {
    await discard(id, saved);
    setOpenId(null);
    router.refresh();
  }

  if (open) {
    return (
      <div className="flex flex-col gap-4">
        <Button type="button" variant="ghost" className="-ml-3 w-fit" onClick={() => setOpenId(null)}>
          Back to the batch
        </Button>
        <PhotoReview
          key={open.id}
          libraryId={libraryId}
          jobId={open.id}
          photoUrl={null}
          items={open.items}
          dropped={0}
          onSaved={() => close(open.id, true)}
          onStartOver={() => close(open.id, false)}
        />
      </div>
    );
  }

  const pct = batch.total > 0 ? Math.min(100, Math.round((batch.processed / batch.total) * 100)) : 0;
  const ready = batch.photos.filter((p) => p.state === "ready").length;
  const waitingCap = batch.photos.some((p) => p.state === "waiting_cap");

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh active={batch.active} />
      {batch.finished && <MarkSeen jobId={batch.jobId} />}

      {batch.queuedJustNow && batch.active && (
        <p role="status" className="rounded-[10px] border border-gilt/50 bg-accent/60 px-4 py-3 text-base">
          Your photos are uploaded. We&apos;ll tell you when they&apos;re ready. You can leave this page; a badge on Activity shows when to come back.
        </p>
      )}

      <section aria-labelledby="batch-heading" className="panel rise flex flex-col gap-4 p-5 md:p-8">
        <div className="flex flex-col gap-1">
          <h2 id="batch-heading" className="text-2xl leading-tight font-medium">
            Your photos
          </h2>
          <p role="status" className="text-base text-muted-foreground">
            {batch.cancelled
              ? "This batch was cancelled."
              : batch.active
                ? waitingCap
                  ? `${batch.processed} of ${batch.total} read. The rest are waiting for tomorrow's allowance.`
                  : `${batch.processed} of ${batch.total} read.`
                : ready > 0
                  ? `${ready} ${ready === 1 ? "photo is" : "photos are"} ready to review.`
                  : "Every photo in this batch is dealt with."}
          </p>
        </div>
        {batch.active && (
          <div role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={batch.total || 100} aria-valuenow={batch.total ? batch.processed : undefined} className="h-1.5 overflow-hidden rounded-full bg-accent">
            <div className="h-full rounded-full bg-gilt transition-[width] duration-[var(--dur)] ease-[var(--ease)] motion-reduce:transition-none" style={{ width: `${Math.max(pct, 4)}%` }} />
          </div>
        )}

        {batch.photos.length === 0 ? (
          <p className="text-base text-muted-foreground">No photos are left in this batch.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {batch.photos.map((p) => (
              <li key={p.id} className="flex min-h-14 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                <div className="flex min-w-0 flex-col">
                  <p className="font-display text-lg leading-snug font-medium">Photo {p.number}</p>
                  <p className={p.state === "failed" ? "flex items-start gap-1.5 text-sm text-destructive" : "flex items-center gap-1.5 text-sm text-muted-foreground"}>
                    {p.state === "reading" && <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />}
                    {p.state === "failed" && <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />}
                    {p.state === "failed" && p.error ? `${PHOTO_STATE_LABEL.failed}: ${p.error}` : PHOTO_STATE_LABEL[p.state]}
                    {p.state === "ready" && ` · ${p.items.length} ${p.items.length === 1 ? "book" : "books"} found`}
                  </p>
                </div>
                {p.state === "ready" && (
                  <Button type="button" variant="outline" className="self-start sm:self-auto" onClick={() => setOpenId(p.id)}>
                    Review photo {p.number}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap gap-1">
        <Link href="/add/photo" className={link}>
          <ImagePlus aria-hidden className="mr-2 size-4" /> Add more photos
        </Link>
        <Link href="/activity" className={link}>
          Open Activity
        </Link>
      </div>
    </div>
  );
}
