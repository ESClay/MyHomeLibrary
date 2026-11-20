"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, CircleAlert, ImagePlus, LoaderCircle, RotateCw } from "lucide-react";
import { SpineRow } from "@/components/shelf";
import { Button } from "@/components/ui/button";
import { downscaleToJpeg } from "@/lib/image";
import { MAX_BATCH_PHOTOS, unfinishedUploads, type UploadState } from "@/lib/scan/batch";
import { MAX_MODEL_IMAGE_BYTES, PHOTO_MAX_SIDE } from "@/lib/scan/photo";
import { createClient } from "@/lib/supabase/client";
import { queuePhotoBatch } from "./actions";

type Item = { key: string; name: string; preview: string; state: UploadState; path: string | null; error?: string };
type Phase = { name: "capture" } | { name: "uploading" } | { name: "queueing" } | { name: "failed"; message: string };

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

/** Tells the server to clear uploaded photos that were never queued. Best effort; the daily sweep catches the rest. */
function discardUploads(paths: string[]) {
  if (paths.length === 0) return;
  const body = JSON.stringify({ paths });
  try {
    if (!navigator.sendBeacon("/api/scan/discard-uploads", new Blob([body], { type: "application/json" }))) {
      void fetch("/api/scan/discard-uploads", { method: "POST", body, keepalive: true });
    }
  } catch {
    /* the sweep will get it */
  }
}

export function PhotoScreen({ libraryId, userId, initialRemaining, cap }: { libraryId: string; userId: string; initialRemaining: number; cap: number }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ name: "capture" });
  const [items, setItems] = useState<Item[]>([]);
  const [remaining, setRemaining] = useState(initialRemaining);
  const [notice, setNotice] = useState<string | null>(null);
  const itemsRef = useRef<Item[]>([]);
  const alive = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const patch = useCallback((key: string, change: Partial<Item>) => {
    itemsRef.current = itemsRef.current.map((i) => (i.key === key ? { ...i, ...change } : i));
    setItems(itemsRef.current);
  }, []);

  // Leaving the page clears only photos that never finished queueing. Queued photos belong to the background job and stay.
  useEffect(() => {
    alive.current = true;
    const clear = () => discardUploads(unfinishedUploads(itemsRef.current));
    window.addEventListener("pagehide", clear);
    return () => {
      alive.current = false;
      window.removeEventListener("pagehide", clear);
      clear();
      for (const i of itemsRef.current) URL.revokeObjectURL(i.preview);
    };
  }, []);

  const queue = useCallback(async () => {
    const paths = itemsRef.current.filter((i) => i.state === "uploaded" && i.path).map((i) => i.path as string);
    if (paths.length === 0) {
      setPhase({ name: "failed", message: "None of those photos could be uploaded." });
      return;
    }
    setPhase({ name: "queueing" });
    const res = await queuePhotoBatch({ libraryId, photoPaths: paths });
    if (!res.ok) {
      if (res.capReached) {
        setRemaining(0);
        discardUploads(paths);
        itemsRef.current = itemsRef.current.map((i) => (i.state === "uploaded" ? { ...i, state: "failed" as const, error: "Not queued" } : i));
        setItems(itemsRef.current);
        setNotice(res.error);
        setPhase({ name: "capture" });
        return;
      }
      setPhase({ name: "failed", message: res.error });
      return;
    }
    // From here the photos belong to the job: nothing is discarded when the page goes.
    itemsRef.current = itemsRef.current.map((i) => (i.state === "uploaded" ? { ...i, state: "queued" as const } : i));
    setItems(itemsRef.current);
    router.push(`/add/photo?batch=${res.jobId}&queued=1`);
  }, [libraryId, router]);

  async function onFiles(list: FileList | null) {
    const files = [...(list ?? [])];
    if (fileRef.current) fileRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
    if (files.length === 0) return;
    const photos = files.filter((f) => f.type.startsWith("image/"));
    setNotice(null);
    if (photos.length === 0) return setNotice("Those files are not photos.");
    const taken = photos.slice(0, MAX_BATCH_PHOTOS);
    if (photos.length > taken.length) setNotice(`Only the first ${MAX_BATCH_PHOTOS} photos were used. Add the rest in another batch.`);

    const fresh: Item[] = taken.map((f) => ({ key: crypto.randomUUID(), name: f.name || "Photo", preview: URL.createObjectURL(f), state: "waiting", path: null }));
    for (const i of itemsRef.current) URL.revokeObjectURL(i.preview);
    itemsRef.current = fresh;
    setItems(fresh);
    setPhase({ name: "uploading" });

    // One after another: a phone connection does better with a single upload at a time.
    for (let n = 0; n < taken.length; n++) {
      if (!alive.current) return;
      const item = fresh[n];
      const path = `${libraryId}/${userId}/${crypto.randomUUID()}.jpg`;
      patch(item.key, { state: "uploading", path });
      try {
        const blob = await prepare(taken[n]);
        const { error } = await createClient().storage.from("scans").upload(path, blob, { contentType: "image/jpeg", cacheControl: "60" });
        if (error) throw new Error("Could not upload. Check your connection.");
        if (!alive.current) {
          discardUploads([path]);
          return;
        }
        patch(item.key, { state: "uploaded" });
      } catch (e) {
        patch(item.key, { state: "failed", path: null, error: e instanceof Error ? e.message : "Could not prepare that photo." });
      }
    }
    if (alive.current) await queue();
  }

  async function startOver() {
    discardUploads(unfinishedUploads(itemsRef.current));
    for (const i of itemsRef.current) URL.revokeObjectURL(i.preview);
    itemsRef.current = [];
    setItems([]);
    setPhase({ name: "capture" });
  }

  const inputs = (
    <>
      <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} aria-label="Choose photos from your library" onChange={(e) => void onFiles(e.target.files)} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label="Take a photo" onChange={(e) => void onFiles(e.target.files)} />
    </>
  );

  if (phase.name === "uploading" || phase.name === "queueing") {
    const done = items.filter((i) => i.state !== "waiting" && i.state !== "uploading").length;
    const pct = items.length ? Math.round((done / items.length) * 100) : 0;
    return (
      <section aria-labelledby="upload-heading" className="panel rise flex flex-col gap-5 p-5 md:p-8">
        <div className="flex flex-col gap-1">
          <h2 id="upload-heading" className="text-2xl leading-tight font-medium">
            {phase.name === "queueing" ? "Queueing your photos" : "Uploading your photos"}
          </h2>
          <p role="status" aria-live="polite" className="text-base text-muted-foreground">
            {phase.name === "queueing" ? "Almost done." : `${done} of ${items.length} uploaded. Keep this page open until they are all up. Then you can leave.`}
          </p>
        </div>
        <div role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 overflow-hidden rounded-full bg-accent">
          <div className="h-full rounded-full bg-gilt transition-[width] duration-[var(--dur)] ease-[var(--ease)] motion-reduce:transition-none" style={{ width: `${Math.max(pct, 4)}%` }} />
        </div>
        <UploadList items={items} />
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
            {items.some((i) => i.state === "uploaded") && (
              <Button type="button" onClick={() => void queue()}>
                <RotateCw aria-hidden /> Try again
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => void startOver()}>
              Choose different photos
            </Button>
          </div>
          {items.length > 0 && <UploadList items={items} />}
        </div>
      )}

      {phase.name === "capture" && (
        <section className="panel rise flex flex-col gap-6 p-5 md:p-8" style={{ ["--i" as string]: 1 }} aria-label="Add photos">
          <SpineRow spines={[...SPINES]} className="mx-auto w-full max-w-xs" />
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="button" size="lg" className="sm:flex-1" disabled={remaining === 0} onClick={() => cameraRef.current?.click()}>
              <Camera aria-hidden /> Take a photo
            </Button>
            <Button type="button" size="lg" variant="outline" className="sm:flex-1" disabled={remaining === 0} onClick={() => fileRef.current?.click()}>
              <ImagePlus aria-hidden /> Choose photos
            </Button>
          </div>
          {(notice || remaining === 0) && (
            <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {notice ?? `You have used all ${cap} photo reads for today. Barcode scanning and search still work.`}
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
            Pick up to {MAX_BATCH_PHOTOS} photos at once. {remaining} of {cap} photo reads left today; any extra photos wait for tomorrow&apos;s allowance. Each photo is deleted as soon as you finish reviewing it.
          </p>
        </section>
      )}
    </div>
  );
}

function UploadList({ items }: { items: Item[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {items.map((i, n) => (
        <li key={i.key} className="flex min-h-14 items-center gap-3 py-2">
          {/* A local object URL for the photo just chosen; next/image cannot optimise it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={i.preview} alt="" className="size-11 shrink-0 rounded-md object-cover shadow-[var(--shadow-cover)]" />
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="text-base font-medium">Photo {n + 1}</p>
            <p className={i.state === "failed" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
              {i.state === "waiting" && "Waiting to upload"}
              {i.state === "uploading" && "Uploading"}
              {(i.state === "uploaded" || i.state === "queued") && "Uploaded"}
              {i.state === "failed" && (i.error ?? "Could not upload")}
            </p>
          </div>
          {i.state === "uploading" && <LoaderCircle aria-hidden className="size-5 shrink-0 animate-spin motion-reduce:animate-none" />}
          {(i.state === "uploaded" || i.state === "queued") && <Check aria-hidden className="size-5 shrink-0 text-gilt" />}
          {i.state === "failed" && <CircleAlert aria-hidden className="size-5 shrink-0 text-destructive" />}
        </li>
      ))}
    </ul>
  );
}
