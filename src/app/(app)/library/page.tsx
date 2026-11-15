import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, SpineRow } from "@/components/shelf";

export const metadata: Metadata = { title: "Library" };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow="Your books"
        title="Library"
        lede="Every book in your home, searchable by title, author or series."
      />
      <EmptyState
        title="The shelves are waiting"
        body="Add your first book and its cover lands here, with both of your ratings and notes beside it. Search, filtering and sorting arrive with the book catalog."
        art={
          <SpineRow
            gap={5}
            spines={[
              { w: 26, h: 118, tone: 1 },
              { w: 20, h: 96, tone: 3 },
              { w: 30, h: 132, tone: 2 },
              { w: 22, h: 104, tone: 5 },
              { w: 28, h: 124, tone: 4 },
              { w: 20, h: 92, tone: 1 },
            ]}
          />
        }
      >
        <div>
          <Button asChild>
            <Link href="/add">Add a book</Link>
          </Button>
        </div>
      </EmptyState>
    </div>
  );
}
