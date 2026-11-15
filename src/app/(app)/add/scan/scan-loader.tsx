"use client";

import dynamic from "next/dynamic";

/** The scanner is browser-only (camera, localStorage), so it never renders on the server. */
const ScanScreen = dynamic(() => import("./scan-screen").then((m) => m.ScanScreen), {
  ssr: false,
  loading: () => (
    <p role="status" className="px-4 py-10 text-center text-sm text-muted-foreground">
      Getting the scanner ready…
    </p>
  ),
});

export function ScanLoader({ libraryId }: { libraryId: string }) {
  return <ScanScreen key={libraryId} libraryId={libraryId} />;
}
