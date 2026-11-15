import type { Metadata } from "next";
import { Camera, ScanBarcode } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shelf";
import { canEdit } from "@/lib/books/access";
import { getLibraryContext } from "@/lib/library";
import { AddBook } from "./add-book";

export const metadata: Metadata = { title: "Add a book" };

const soon = [
  {
    icon: ScanBarcode,
    title: "Scan a barcode",
    body: "Point the camera at the ISBN on the back, one book after another.",
  },
  {
    icon: Camera,
    title: "Photograph covers",
    body: "Snap a shelf or a stack and confirm the books it recognises.",
  },
] as const;

export default async function Page() {
  const { current } = await getLibraryContext();
  if (!current) return null; // The layout shows the create-library prompt.
  const editor = canEdit(current.role);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow="New arrivals"
        title="Add a book"
        lede={editor ? `Search by title, author or ISBN and it lands in ${current.name}.` : undefined}
      />

      {editor ? (
        <AddBook libraryId={current.id} />
      ) : (
        <p className="panel p-5 text-base">
          You have view-only access to {current.name}. Ask an owner to make you an editor if you want to add books.
        </p>
      )}

      <section aria-labelledby="soon-heading" className="flex flex-col gap-3">
        <h2 id="soon-heading" className="eyebrow">
          Coming next
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {soon.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="rise panel flex items-start gap-4 p-4" style={{ ["--i" as string]: i + 1 }}>
              <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <Icon className="size-5" strokeWidth={1.5} aria-hidden />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg leading-snug font-medium">{title}</h3>
                  <Badge variant="outline">Soon</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
