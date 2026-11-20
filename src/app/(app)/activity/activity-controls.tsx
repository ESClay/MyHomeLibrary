"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancelJob, markJobSeen, runJobsNow, undoAllChanges, undoBookChange } from "./actions";

/** Clears the nav badge for a job once its review is open. */
export function MarkSeen({ jobId }: { jobId: string }) {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    markJobSeen(jobId).then((res) => {
      if (res.ok && !cancelled) router.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [jobId, router]);
  return null;
}

export function CancelJobButton({ jobId, label = "Cancel" }: { jobId: string; label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await cancelJob(jobId);
            if (res.ok) router.refresh();
            else setError(res.error);
          })
        }
      >
        <X aria-hidden />
        {pending ? "Cancelling…" : label}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Undoes one book (when `bookId` is given) or every change of the job. */
export function UndoButton({ jobId, bookId, title, count }: { jobId: string; bookId?: string; title?: string; count?: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const all = !bookId;
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button
        type="button"
        variant={all ? "outline" : "ghost"}
        size={all ? "default" : "sm"}
        disabled={pending}
        aria-label={all ? undefined : `Undo the change to ${title}`}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const res = bookId ? await undoBookChange({ jobId, bookId }) : await undoAllChanges({ jobId });
            if (!res.ok) return setMessage(res.error);
            if (res.edited > 0) setMessage(`${res.edited} left as they are: edited since.`);
            router.refresh();
          })
        }
      >
        <Undo2 aria-hidden />
        {pending ? "Undoing…" : all ? (count ? `Undo all ${count}` : "Undo all") : "Undo"}
      </Button>
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}

/** Development only: works the queue now, since pg_cron cannot reach localhost. */
export function RunJobsNowButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-dashed border-input p-4">
      <p className="eyebrow text-gilt">Development only</p>
      <p className="text-sm text-muted-foreground">pg_cron cannot reach localhost, so run the worker from here.</p>
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await runJobsNow();
            setMessage(res.ok ? res.message : res.error);
            router.refresh();
          })
        }
      >
        <Play aria-hidden />
        {pending ? "Running jobs…" : "Run jobs now"}
      </Button>
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {message}
      </p>
    </div>
  );
}
