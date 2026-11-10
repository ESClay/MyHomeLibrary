import type { Metadata } from "next";

export const metadata: Metadata = { title: "Library" };

export default function Page() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Library</h1>
      <p className="text-muted-foreground">Your books will appear here. Coming soon.</p>
    </div>
  );
}
