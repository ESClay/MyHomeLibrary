import type { Metadata } from "next";

export const metadata: Metadata = { title: "Shelves" };

export default function Page() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Shelves</h1>
      <p className="text-muted-foreground">Organize books into shelves. Coming soon.</p>
    </div>
  );
}
