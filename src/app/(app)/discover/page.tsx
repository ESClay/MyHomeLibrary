import type { Metadata } from "next";
import { EmptyState, PageHeader, SpineRow } from "@/components/shelf";

export const metadata: Metadata = { title: "Discover" };

export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow="What to read next"
        title="Discover"
        lede="Fill the gaps in the series you own, then find something new."
      />
      <EmptyState
        title="Complete your series"
        body="When a series on your shelf is missing a volume, the gap shows up here, ready to add to your wishlist."
        art={
          <SpineRow
            gap={2}
            spines={[
              { w: 24, h: 112, tone: 2 },
              { w: 24, h: 112, tone: 2 },
              { w: 24, h: 112, tone: 2 },
              { w: 24, h: 112, tone: 2 },
            ]}
          />
        }
      />
      <section className="rise panel flex flex-col gap-4 p-5 md:p-8" style={{ ["--i" as string]: 2 }}>
        <div className="flex max-w-prose flex-col gap-2">
          <h2 className="text-2xl leading-tight font-medium">For you</h2>
          <p className="text-base text-muted-foreground">
            Picks based on what each of you rated highest, each with the reason it was chosen.
          </p>
        </div>
        <div aria-hidden className="flex gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex w-1/3 max-w-28 flex-col gap-2">
              <div className="book-cover border border-dashed border-input bg-transparent shadow-none" />
              <span className="h-2 w-4/5 rounded-full bg-muted" />
              <span className="h-2 w-3/5 rounded-full bg-muted" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
