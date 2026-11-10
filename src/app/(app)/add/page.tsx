import type { Metadata } from "next";

export const metadata: Metadata = { title: "Add a book" };

export default function Page() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Add a book</h1>
      <p className="text-muted-foreground">Scan a barcode, photograph covers, or search. Coming soon.</p>
    </div>
  );
}
