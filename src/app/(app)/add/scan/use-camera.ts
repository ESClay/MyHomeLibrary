"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CameraProblem = "insecure" | "unsupported" | "denied" | "nocamera" | "busy" | "unknown";
export type CameraStatus = "idle" | "starting" | "live" | "error";

export const CAMERA_MESSAGE: Record<CameraProblem, { title: string; body: string }> = {
  insecure: {
    title: "The camera needs a secure connection",
    body: "Browsers only allow camera access on HTTPS pages. Open the app at its https:// address, or type the ISBN below.",
  },
  unsupported: {
    title: "This browser can't open the camera",
    body: "Try the latest Safari, Chrome or Firefox, or type the ISBN below.",
  },
  denied: {
    title: "Camera access is blocked",
    body: "Allow the camera for this site in your browser's settings, then try again. Or type the ISBN below.",
  },
  nocamera: {
    title: "No camera found",
    body: "This device has no camera the browser can use. Type the ISBN below instead.",
  },
  busy: {
    title: "The camera is busy",
    body: "Another app may be using it. Close it and try again, or type the ISBN below.",
  },
  unknown: {
    title: "The camera didn't start",
    body: "Something went wrong opening it. Try again, or type the ISBN below.",
  },
};

export function classifyCameraError(err: unknown): CameraProblem {
  const name = (err as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "nocamera";
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") return "busy";
  return "unknown";
}

/** How often a frame is decoded, at most. The decoder itself is the other limit. */
const FRAME_INTERVAL_MS = 110;
/** Longest edge of the frame handed to the decoder; larger video is scaled down. */
const MAX_DECODE_WIDTH = 960;

/**
 * The rear camera plus an EAN-13 decode loop (zxing-wasm).
 * - Runs only while `enabled`; stops every track on unmount, when disabled, and when the tab is hidden,
 *   then starts again when the tab returns.
 * - `onDetect` gets each decoded symbol (the caller decides what counts and handles repeats).
 */
export function useCamera({
  enabled,
  onDetect,
}: {
  enabled: boolean;
  onDetect: (text: string, format: string) => void;
}) {
  const videoEl = useRef<HTMLVideoElement | null>(null);
  /** Callback ref for the <video> element. */
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoEl.current = el;
  }, []);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const onDetectRef = useRef(onDetect);
  useEffect(() => {
    onDetectRef.current = onDetect;
  });

  const streamRef = useRef<MediaStream | null>(null);
  const run = useRef(0); // bumped on every start/stop so stale loops and late permission answers retire.
  const wantRef = useRef(false); // the camera should be running (enabled, not user-stopped).

  const stop = useCallback(() => {
    run.current++;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoEl.current) videoEl.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    stop();
    const mine = run.current;
    setProblem(null);

    if (typeof window === "undefined") return;
    if (!window.isSecureContext) {
      setProblem("insecure");
      setStatus("error");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setProblem("unsupported");
      setStatus("error");
      return;
    }

    setStatus("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (err) {
      if (run.current !== mine) return;
      setProblem(classifyCameraError(err));
      setStatus("error");
      return;
    }
    if (run.current !== mine) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    setTorchOn(false);

    const track = stream.getVideoTracks()[0];
    try {
      setTorchSupported(!!(track?.getCapabilities?.() as { torch?: boolean } | undefined)?.torch);
    } catch {
      setTorchSupported(false);
    }

    const video = videoEl.current;
    if (!video) return;
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      // Autoplay can be refused until a gesture; muted + playsInline normally allows it.
    }
    if (run.current !== mine) return;
    setStatus("live");

    // Decode loop.
    const [{ readBarcodes, prepareZXingModule }] = await Promise.all([import("zxing-wasm/reader")]);
    if (run.current !== mine) return;
    prepareZXingModule({
      overrides: { locateFile: (path, prefix) => (path.endsWith(".wasm") ? "/zxing_reader.wasm" : prefix + path) },
    });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    while (run.current === mine) {
      const t0 = performance.now();
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (video.readyState >= 2 && vw > 0 && vh > 0) {
        // The middle band of the frame: wide and not too tall, where the on-screen guide sits.
        const sw = vw * 0.92;
        const sh = Math.min(vh, sw * 0.6);
        const sx = (vw - sw) / 2;
        const sy = (vh - sh) / 2;
        const scale = Math.min(1, MAX_DECODE_WIDTH / sw);
        canvas.width = Math.round(sw * scale);
        canvas.height = Math.round(sh * scale);
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        try {
          const results = await readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), {
            formats: ["EAN13"],
            tryHarder: true,
            maxNumberOfSymbols: 1,
            eanAddOnSymbol: "Ignore",
          });
          if (run.current !== mine) break;
          for (const r of results) if (r.isValid && r.text) onDetectRef.current(r.text, r.format);
        } catch {
          // A frame that fails to decode is just skipped.
        }
      }
      const wait = FRAME_INTERVAL_MS - (performance.now() - t0);
      await new Promise((r) => setTimeout(r, Math.max(16, wait)));
    }
  }, [stop]);

  // Start when enabled; stop when disabled or unmounted.
  useEffect(() => {
    wantRef.current = enabled;
    // Deferred a tick: start() sets state, and an effect should not do that synchronously.
    if (enabled) queueMicrotask(() => wantRef.current && void start());
    else stop();
    return () => {
      wantRef.current = false;
      stop();
    };
  }, [enabled, start, stop]);

  // Release the camera while the tab is hidden; take it back on return.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        stop();
        setStatus((s) => (s === "error" ? s : "idle"));
      } else if (wantRef.current && !streamRef.current) {
        void start();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", stop);
    };
  }, [start, stop]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
      setTorchOn(false);
    }
  }, [torchOn]);

  return { attachVideo, status: enabled ? status : ("idle" as CameraStatus), problem, torchSupported: status === "live" && torchSupported, torchOn: status === "live" && torchOn, toggleTorch, retry: start };
}
