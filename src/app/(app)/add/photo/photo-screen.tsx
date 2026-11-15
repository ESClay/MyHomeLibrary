"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CircleAlert, ImagePlus, LoaderCircle, RotateCw } from "lucide-react";
import { SpineRow } from "@/components/shelf";
import { Button } from "@/components/ui/button";
import { downscaleToJpeg } from "@/lib/image";
import { MAX_MODEL_IMAGE_BYTES, PHOTO_MAX_SIDE } from "@/lib/scan/photo";
import type { ScanItem } from "@/lib/scan/resolve";
import { createClient } from "@/lib/supabase/client";
import { startScan } from "./actions";
import { PhotoReview } from "./photo-review";

type Phase =
  | { name: "capture" }
  | { name: "working"; step: "uploading" | "reading" }
  | { name: "failed"; message: string; retry: boolean }
  | { name: "review"; jobId: string; items: ScanItem[]; dropped: number };

type Job = { id: string; path: string };

const SPINES = [
  { w: 22, h: 70, tone: 1 },
  { w: 18, h: 56, tone: 3 },
  { w: 26, h: 82, tone: 2 },
  { w: 20, h: 64, tone: 5 },
  { w: 24, h: 76, tone: 4 },
  { w: 18, h: 60, tone: 1 },
] as const;

const TIPS = [
  "Keep the titles facing the camera and the light even, with no glare on glossy jackets.",
  "For a shelf, stand square to it and fill the frame. A few dozen spines read better than a whole wall.",
  "You see every book before anything is saved, and you can swap or skip any of them.",
];

/** Shrinks a photo until the JPEG fits what the server will send to the model. */
async function prepare(file: File): Promise<Blob> {
  let blob = await downscaleToJpeg(file, PHOTO_MAX_SIDE, 0.85);
  if (blob.size > MAX_MODEL_IMAGE_BYTES) blob = await downscaleToJpeg(file, 1600, 0.7);
  if (blob.size > MAX_MODEL_IMAGE_BYTES) blob = await downscaleToJpeg(file, 1200, 0.6);
  if (blob.size > MAX_MODEL_IMAGE_BYTES) throw new Error("That photo is too large to read. Try a smaller one.");
  return blob;
}

export function PhotoScreen({
  libraryId,
  userId,
  initialRemaining,
  cap,
}: {
  libraryId: string;
  userId: string;
  initialRemaining: number;
  cap: number;
}) {
  const [phase, setPhase] = useState<Phase>({ name: "capture" });
  const [remaining, setRemaining] = useState(initialRemaining);
  const [preview, setPreview] = useState<string | null>(null);
  const [capMessage, setCapMessage] = useState<string | null>(null);
  const job = useRef<Job | null>(null); // the live scan whose photo is still in storage
  const pendingPath = useRef<string | null>(null); // uploaded, but no job yet
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  // Leaving the page (tab closed, navigation) clears the photo, best effort. A cron sweep catches the rest.
  useEffect(() => {
    const clear = () => {
      const j = job.current;
      if (!j) return;
      job.current = null;
      try {
        if (!navigator.sendBeacon(`/api/scan/${j.id}/discard`)) {
          void fetch(`/api/scan/${j.id}/discard`, { method: "POST", keepalive: true });
        }
      } catch {
        /* the sweep will get it */
      }
    };
    window.addEventListener("pagehide", clear);
    return () => {
      window.removeEventListener("pagehide", clear);
      clear();
    };
  }, []);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const discardPhoto = useCallback(async (saved: boolean) => {
    const j = job.current;
    job.current = null;
    if (j) {
      try {
        await fetch(`/api/scan/${j.id}/discard${saved ? "?saved=1" : ""}`, { method: "POST", keepalive: true });
      } catch {
        /* the sweep will get it */
      }
    } else if (pendingPath.current) {
      await createClient().storage.from("scans").remove([pendingPath.current]).catch(() => undefined);
    }
    pendingPath.current = null;
  }, []);

  const read = useCallback(
    async (path: string) => {
      setPhase({ name: "working", step: "reading" });
      const started = await startScan({ libraryId, photoPath: path });
      if (!started.ok) {
        if (started.capReached) {
          setCapMessage(started.error);
          setRemaining(0);
          await discardPhoto(false);
          setPhase({ name: "capture" });
        } else {
          setPhase({ name: "failed", message: started.error, retry: false });
        }
        return;
      }
      job.current = { id: started.jobId, path };
      pendingPath.current = null;
      setRemaining(started.remaining);

      let body: { ok: boolean; items?: ScanItem[]; dropped?: number; error?: string };
      try {
        const res = await fetch(`/api/scan/${started.jobId}`, { method: "POST" });
        body = (await res.json()) as typeof body;
      } catch {
        setPhase({ name: "failed", message: "The connection dropped while reading. Try again.", retry: true });
        return;
      }
      if (!body.ok || !body.items) {
        setPhase({ name: "failed", message: body.error ?? "Something went wrong reading that photo.", retry: true });
        return;
      }
      setPhase({ name: "review", jobId: started.jobId, items: body.items, dropped: body.dropped ?? 0 });
    },
    [libraryId, discardPhoto],
  );

  async function onFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhase({ name: "failed", message: "That file is not a photo.", retry: false });
      return;
    }
    setCapMessage(null);
    setPreview(URL.createObjectURL(file));
    setPhase({ name: "working", step: "uploading" });
    try {
      const blob = await prepare(file);
      const path = `${libraryId}/${userId}/${crypto.randomUUID()}.jpg`;
      const { error } = await createClient().storage.from("scans").upload(path, blob, {
        contentType: "image/jpeg",
        cacheControl: "60",
      });
      if (error) throw new Error("The photo could not be uploaded. Check your connection and try again.");
      pendingPath.current = path;
      await read(path);
    } catch (e) {
      setPhase({ name: "failed", message: e instanceof Error ? e.message : "The photo could not be prepared.", retry: false });
    }
  }

  async function startOver() {
    await discardPhoto(false);
    setPreview(null);
    setPhase({ name: "capture" });
  }

  async function retry() {
    const path = job.current?.path ?? pendingPath.current;
    if (!path) return startOver();
    pendingPath.current = path;
    job.current = null; // the failed job is finished; a new one is counted and run
    await read(path);
  }

  const inputs = (
    <>
      <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label="Choose a photo from your library" onChange={(e) => void onFile(e.target.files?.[0])} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label="Take a photo" onChange={(e) => void onFile(e.target.files?.[0])} />
    </>
  );

  if (phase.name === "review") {
    return (
      <PhotoReview
        libraryId={libraryId}
        jobId={phase.jobId}
        photoUrl={preview}
        items={phase.items}
        dropped={phase.dropped}
        onSaved={() => discardPhoto(true)}
        onStartOver={startOver}
      />
    );
  }

  if (phase.name === "working") {
    return (
      <section aria-label="Reading your photo" className="panel rise flex flex-col gap-5 p-4 md:p-5">
        <div
          className="relative mx-auto aspect-[4/3] w-full max-w-xl overflow-hidden rounded-lg bg-paper-deep shadow-[var(--shadow-cover)]"
        >
          {preview && (
            // A local object URL for the photo just taken; next/image cannot optimise it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Your photo" className="size-full object-cover" />
          )}
          <div aria-hidden className="absolute inset-0 bg-black/20" />
          <div aria-hidden className="read-sweep absolute inset-x-0 h-0.5 bg-[var(--brand-gilt)] shadow-[0_0_14px_2px_var(--brand-gilt)]" />
        </div>
        <div role="status" aria-live="polite" className="flex items-start gap-3">
          <LoaderCircle aria-hidden className="mt-0.5 size-5 shrink-0 animate-spin motion-reduce:animate-none" />
          <div className="flex flex-col gap-1">
            <p className="font-display text-xl leading-snug font-medium">
              {phase.step === "uploading" ? "Uploading your photo…" : "Reading the books…"}
            </p>
            <p className="text-sm text-muted-foreground">A full shelf can take a minute. Stay on this page until it finishes.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {inputs}
      {phase.name === "failed" && (
        <div role="alert" className="panel flex flex-col gap-3 border-destructive/40 p-4">
          <p className="flex items-start gap-2 text-base">
            <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-destructive" /> {phase.message}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {phase.retry && (
              <Button type="button" onClick={() => void retry()}>
                <RotateCw aria-hidden /> Try again
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => void startOver()}>
              Use a different photo
            </Button>
          </div>
        </div>
      )}

      {phase.name === "capture" && (
        <section className="panel rise flex flex-col gap-6 p-5 md:p-8" style={{ ["--i" as string]: 1 }}>
          <SpineRow spines={[...SPINES]} className="mx-auto w-full max-w-xs" />
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="button" size="lg" className="sm:flex-1" disabled={remaining === 0} onClick={() => cameraRef.current?.click()}>
              <Camera aria-hidden /> Take a photo
            </Button>
            <Button type="button" size="lg" variant="outline" className="sm:flex-1" disabled={remaining === 0} onClick={() => fileRef.current?.click()}>
              <ImagePlus aria-hidden /> Choose from my photos
            </Button>
          </div>
          {(capMessage || remaining === 0) && (
            <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {capMessage ?? `You have used all ${cap} photo reads for today. Barcode scanning and search still work.`}
            </p>
          )}
          <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
            {TIPS.map((t) => (
              <li key={t} className="flex gap-2">
                <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-gilt" />
                {t}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {remaining} of {cap} photo reads left today. The photo is deleted as soon as you finish reviewing.
          </p>
        </section>
      )}
    </div>
  );
}
