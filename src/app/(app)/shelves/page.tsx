import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/shelf";

export const metadata: Metadata = { title: "Shelves" };

function BlankRow({ count, lean }: { count: number; lean?: number }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-end gap-2 px-2">
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className={
              "book-cover w-[22%] max-w-16 border border-dashed border-input bg-transparent shadow-none" +
              (i === lean ? " origin-bottom-left rotate-[6deg]" : "")
            }
          />
        ))}
      </div>
      <div className="shelf-line" />
    </div>
  );
}

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow="Rooms and rows"
        title="Shelves"
        lede="Group books the way they sit at home: by room, by mood, by who is reading them."
      />
      <EmptyState
        title="No shelves yet"
        body="Shelves appear here as stacked rows of covers, one row each, so the screen looks like the wall of books in your living room."
        art={
          <div aria-hidden className="flex flex-col gap-6">
            <BlankRow count={4} />
            <BlankRow count={3} lean={2} />
          </div>
        }
      />
    </div>
  );
}
