import type { Metadata } from "next";

export const metadata: Metadata = { title: "Discover" };

export default function Page() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Discover</h1>
      <p className="text-muted-foreground">Complete your series and get recommendations. Coming soon.</p>
    </div>
  );
}
