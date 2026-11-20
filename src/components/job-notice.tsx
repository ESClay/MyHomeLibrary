"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

const KEY = "jobNoticeDismissed";
const listeners = new Set<() => void>();

function read(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** A short notice after a background job finishes. Dismissing it is remembered on this device; the nav badge stays until the review is opened. */
export function JobNotice({ jobId, text, href, label = "Review changes" }: { jobId: string; text: string; href: string; label?: string }) {
  // The server snapshot is "dismissed", so the notice never flashes in during hydration for someone who already closed it.
  const dismissed = useSyncExternalStore(subscribe, read, () => jobId);
  const pathname = usePathname();
  if (dismissed === jobId || pathname.startsWith("/activity")) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(KEY, jobId);
    } catch {
      // storage unavailable: the notice stays until the review is opened
    }
    listeners.forEach((l) => l());
  }

  return (
    <div role="status" className="mx-auto mb-5 flex w-full max-w-5xl items-center gap-3 rounded-[10px] border border-gilt/50 bg-accent/60 py-2 pr-2 pl-4 text-sm">
      <p className="min-w-0 flex-1 text-pretty">{text}</p>
      <Button asChild size="sm" variant="outline">
        <Link href={href}>{label}</Link>
      </Button>
      <Button type="button" size="icon" variant="ghost" onClick={dismiss} aria-label="Dismiss this notice">
        <X aria-hidden />
      </Button>
    </div>
  );
}
