"use client";

import Image from "next/image";
import { isOptimizableCover } from "@/lib/cover-image";
import { useId, useRef, useState } from "react";
import { Camera, ImagePlus, Check, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downscaleToJpeg } from "@/lib/image";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type PickerCover = { url: string; label: string };

/**
 * Choose a cover from provider candidates, upload a photo, or take one with the camera.
 * Uploads go to the `covers` bucket under `<libraryId>/`; storage policies limit that to editors.
 */
export function CoverPicker({
  libraryId,
  candidates,
  value,
  onChange,
}: {
  libraryId: string;
  candidates: PickerCover[];
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const [uploads, setUploads] = useState<PickerCover[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const name = useId();

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const blob = await downscaleToJpeg(file);
      const supabase = createClient();
      const path = `${libraryId}/${crypto.randomUUID()}.jpg`;
      const { error: upError } = await supabase.storage.from("covers").upload(path, blob, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
      });
      if (upError) throw new Error(upError.message);
      const { data } = supabase.storage.from("covers").getPublicUrl(path);
      setUploads((u) => [...u, { url: data.publicUrl, label: "Your photo" }]);
      onChange(data.publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The photo could not be uploaded.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  }

  const all = [...uploads, ...candidates.filter((c) => !uploads.some((u) => u.url === c.url))];

  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-1 text-sm font-semibold">Cover</legend>
      <div role="radiogroup" aria-label="Cover" className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
        <label className="flex shrink-0 cursor-pointer flex-col items-center gap-1.5">
          <input
            type="radio"
            name={name}
            className="peer sr-only"
            checked={value === null}
            onChange={() => onChange(null)}
          />
          <span className="flex h-28 w-[4.5rem] items-center justify-center rounded-[4px] border border-dashed border-input bg-secondary text-muted-foreground transition-colors peer-checked:border-gilt peer-checked:ring-2 peer-checked:ring-gilt peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
            <ImageOff className="size-5" aria-hidden />
          </span>
          <span className="text-xs text-muted-foreground">No cover</span>
        </label>
        {all.map((c) => (
          <label key={c.url} className="flex shrink-0 cursor-pointer flex-col items-center gap-1.5">
            <input
              type="radio"
              name={name}
              className="peer sr-only"
              checked={value === c.url}
              onChange={() => onChange(c.url)}
            />
            <span
              className={cn(
                "relative block h-28 w-[4.5rem] overflow-hidden rounded-[4px] bg-paper-deep shadow-[var(--shadow-cover)] transition-transform duration-[var(--dur-fast)] hover:-translate-y-0.5 peer-checked:ring-2 peer-checked:ring-gilt peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
              )}
            >
              <Image
                src={c.url}
                alt={`${c.label} cover option`}
                fill
                sizes="72px"
                unoptimized={!isOptimizableCover(c.url)}
                referrerPolicy="no-referrer"
                className="object-cover"
              />
              {value === c.url && (
                <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-gilt text-background">
                  <Check className="size-3" aria-hidden />
                </span>
              )}
            </span>
            <span className="max-w-[4.5rem] truncate text-xs text-muted-foreground">{c.label}</span>
          </label>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
          <ImagePlus aria-hidden /> Upload a photo
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => cameraRef.current?.click()}>
          <Camera aria-hidden /> Take a photo
        </Button>
        {busy && (
          <span role="status" className="flex items-center text-sm text-muted-foreground">
            Uploading…
          </span>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label="Upload a cover photo" onChange={(e) => upload(e.target.files?.[0])} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label="Take a cover photo" onChange={(e) => upload(e.target.files?.[0])} />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
