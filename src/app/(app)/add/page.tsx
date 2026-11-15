import type { Metadata } from "next";
import { Camera, ScanBarcode, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shelf";

export const metadata: Metadata = { title: "Add a book" };

const ways = [
  {
    icon: ScanBarcode,
    title: "Scan a barcode",
    body: "Point the camera at the ISBN on the back. Keep scanning, one book after another.",
  },
  {
    icon: Camera,
    title: "Photograph covers",
    body: "Snap a shelf or a stack and confirm the books it recognises.",
  },
  {
    icon: Search,
    title: "Search by title",
    body: "Look up a book by title or author, then pick the cover that matches yours.",
  },
] as const;

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow="New arrivals"
        title="Add a book"
        lede="Three ways to bring a book onto the shelf. They open up one by one."
      />
      <ul className="grid gap-3 md:grid-cols-3">
        {ways.map(({ icon: Icon, title, body }, i) => (
          <li
            key={title}
            className="rise panel flex flex-col gap-4 p-5 md:min-h-56"
            style={{ ["--i" as string]: i + 1 }}
          >
            <div className="flex items-start justify-between">
              <span className="flex size-12 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <Icon className="size-6" strokeWidth={1.5} aria-hidden />
              </span>
              <Badge variant="outline">Soon</Badge>
            </div>
            <div className="flex flex-col gap-1.5">
              <h2 className="text-xl leading-snug font-medium">{title}</h2>
              <p className="text-sm text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
