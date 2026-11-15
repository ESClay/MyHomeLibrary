"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CircleAlert, Flashlight, FlashlightOff, Keyboard, LoaderCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BookMetadata } from "@/lib/metadata/types";
import { classifyScan, RepeatGuard } from "@/lib/scan/isbn-scan";
import type { TrayItem } from "@/lib/scan/tray";
import { cn } from "@/lib/utils";
import { ManualIsbn } from "./manual-isbn";
import { ReviewSheet } from "./review-sheet";
import { Tray } from "./tray";
import { CAMERA_MESSAGE, useCamera } from "./use-camera";
import { useTray } from "./use-tray";

type Notice = { id: number; tone: "ok" | "warn"; text: string };

const topButton =
  "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition-[background-color,transform] duration-[var(--dur-fast)] hover:bg-black/65 active:scale-95 focus-visible:outline-[var(--brand-gilt)]";

export function ScanScreen({ libraryId }: { libraryId: string }) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [flash, setFlash] = useState(0);
  const guard = useRef(new RepeatGuard());
  const noticeId = useRef(0);

  const say = useCallback((tone: Notice["tone"], text: string, visible = true) => {
    setAnnouncement(text);
    if (visible) setNotice({ id: ++noticeId.current, tone, text });
  }, []);

  const onResolved = useCallback(
    (item: TrayItem, meta: BookMetadata | null) => {
      const inLib = !!item.duplicates && item.duplicates.length > 0;
      if (!meta) setAnnouncement(inLib ? `ISBN ${item.isbn} is already in your library.` : `No match found for ISBN ${item.isbn}.`);
      else setAnnouncement(`${meta.title}${inLib ? ", already in your library" : ""}.`);
    },
    [],
  );

  const tray = useTray(libraryId, onResolved);
  const { add } = tray;

  const onDetect = useCallback(
    (text: string, format: string) => {
      const c = classifyScan(text, format);
      if (c.kind === "ignore") return;
      const now = Date.now();
      if (c.kind === "other") {
        if (guard.current.check(`other:${text}`, now)) say("warn", "That's not an ISBN barcode");
        return;
      }
      if (!guard.current.check(c.isbn, now)) return;
      if (add(c.isbn)) {
        try {
          navigator.vibrate?.(40);
        } catch {
          // Not every browser allows it; the flash still shows.
        }
        setFlash((f) => f + 1);
        say("ok", "Added to your tray");
      } else {
        say("warn", "Already in your tray");
      }
    },
    [add, say],
  );

  const { attachVideo, status: camStatus, problem: camProblem, torchSupported, torchOn, toggleTorch, retry: retryCamera } = useCamera({
    enabled: !reviewOpen,
    onDetect,
  });

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice((n) => (n?.id === notice.id ? null : n)), 2400);
    return () => clearTimeout(t);
  }, [notice]);

  function addManual(isbn: string) {
    const added = add(isbn);
    say(added ? "ok" : "warn", added ? "Added to your tray" : "Already in your tray", false);
    return added;
  }

  const cameraProblem = camStatus === "error" && camProblem ? CAMERA_MESSAGE[camProblem] : null;
  const showManual = manualOpen || !!cameraProblem;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#16120e] md:static md:z-auto md:grid md:grid-cols-[minmax(0,1fr)_24rem] md:items-start md:gap-6 md:bg-transparent">
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div className="flex min-h-0 flex-1 flex-col md:flex-none md:gap-5">
        <div
          role="group"
          aria-label="Barcode viewfinder"
          className="relative min-h-0 flex-1 overflow-hidden bg-[#16120e] text-[#efe6d4] md:aspect-[4/3] md:flex-none md:rounded-[14px] md:border md:border-border"
        >
          <video
            ref={attachVideo}
            aria-label="Live camera view for scanning book barcodes"
            playsInline
            muted
            autoPlay
            className={cn("absolute inset-0 size-full object-cover transition-opacity duration-[var(--dur)]", camStatus === "live" ? "opacity-100" : "opacity-0")}
          />

          {/* Scan-area guide: the outside is dimmed by a huge shadow; brass corners and a sweeping line mark the target. */}
          {camStatus === "live" && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4">
              <div
                aria-hidden
                style={{ ["--scan-h" as string]: "8rem" }}
                className="relative h-32 w-[86%] max-w-md rounded-lg shadow-[0_0_0_100vmax_rgb(10_8_5/0.5)]"
              >
                {(["top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-lg", "top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-lg", "bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-lg", "right-0 bottom-0 border-r-[3px] border-b-[3px] rounded-br-lg"] as const).map((c) => (
                  <span key={c} className={cn("absolute size-7 border-[var(--brand-gilt)]", c)} />
                ))}
                <span className="scan-sweep absolute inset-x-3 top-0 h-0.5 rounded-full bg-[var(--brand-gilt)] shadow-[0_0_10px_var(--brand-gilt)]" />
              </div>
              <p className="relative z-10 max-w-[18rem] px-2 text-center text-sm text-[#efe6d4]/90 [text-shadow:0_1px_3px_rgb(0_0_0/0.8)]">
                Line up the barcode on the back cover. Scan one after another.
              </p>
            </div>
          )}

          {flash > 0 && <div key={flash} aria-hidden className="scan-flash pointer-events-none absolute inset-0 bg-[var(--brand-gilt)]/55" />}

          {camStatus === "starting" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm">
              <LoaderCircle aria-hidden className="size-6 animate-spin motion-reduce:animate-none" />
              Opening the camera…
            </div>
          )}

          {cameraProblem && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
              <CircleAlert aria-hidden className="size-7 text-[var(--brand-gilt)]" />
              <h2 className="font-display text-xl leading-snug font-medium">{cameraProblem.title}</h2>
              <p className="max-w-xs text-sm text-[#efe6d4]/80">{cameraProblem.body}</p>
              {camProblem !== "insecure" && camProblem !== "unsupported" && (
                <Button type="button" variant="secondary" onClick={() => void retryCamera()}>
                  Try the camera again
                </Button>
              )}
            </div>
          )}

          {notice && (
            <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-4">
              <p
                key={notice.id}
                className={cn(
                  "rise flex items-center gap-2 rounded-full bg-black/75 px-4 py-2 text-sm font-medium backdrop-blur",
                  notice.tone === "ok" ? "text-white" : "text-[var(--brand-gilt)]",
                )}
              >
                {notice.tone === "ok" ? <Check aria-hidden className="size-4" /> : <CircleAlert aria-hidden className="size-4" />}
                {notice.text}
              </p>
            </div>
          )}

          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] md:pt-3">
            <Link href="/add" aria-label="Back to Add a book" className={cn(topButton, "md:hidden")}>
              <ArrowLeft aria-hidden className="size-5" />
            </Link>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                aria-pressed={showManual}
                aria-label="Type an ISBN instead"
                onClick={() => setManualOpen((v) => !v)}
                className={cn(topButton, "md:hidden", showManual && "bg-[var(--brand-gilt)] text-[#16120e] hover:bg-[var(--brand-gilt)]")}
              >
                <Keyboard aria-hidden className="size-5" />
              </button>
              {torchSupported && (
                <button type="button" aria-pressed={torchOn} aria-label="Torch" onClick={() => void toggleTorch()} className={cn(topButton, torchOn && "bg-[var(--brand-gilt)] text-[#16120e] hover:bg-[var(--brand-gilt)]")}>
                  {torchOn ? <Flashlight aria-hidden className="size-5" /> : <FlashlightOff aria-hidden className="size-5" />}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className={cn("border-t border-border bg-card px-4 py-3 text-card-foreground md:block md:rounded-[14px] md:border md:p-5 md:shadow-[var(--shadow-card)]", showManual ? "block" : "hidden")}>
          <ManualIsbn onAdd={addManual} />
        </div>
      </div>

      <Tray items={tray.items} dispatch={tray.dispatch} storageFailed={tray.storageFailed} onReview={() => setReviewOpen(true)} />

      {reviewOpen && (
        <ReviewSheet
          libraryId={libraryId}
          items={tray.items}
          dispatch={tray.dispatch}
          onClose={() => setReviewOpen(false)}
        />
      )}
    </div>
  );
}
