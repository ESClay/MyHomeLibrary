import { BrandMark, Wordmark } from "@/components/brand";
import { SpineRow } from "@/components/shelf";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <aside className="hidden flex-col justify-between bg-[var(--brand-ground)] p-12 text-[var(--brand-ink)] md:flex">
        <div className="flex items-center gap-3">
          <BrandMark className="size-9" />
          <Wordmark className="text-2xl [&_em]:text-[var(--brand-gilt)]" />
        </div>
        <div className="flex flex-col gap-10">
          <p className="max-w-md font-display text-4xl leading-[1.15] font-medium">
            One shelf for the two of you.
          </p>
          <SpineRow
            className="max-w-md opacity-95"
            spines={[
              { w: 30, h: 150, tone: 1 },
              { w: 24, h: 122, tone: 3 },
              { w: 34, h: 168, tone: 4 },
              { w: 26, h: 134, tone: 5 },
              { w: 30, h: 156, tone: 3 },
              { w: 22, h: 118, tone: 1 },
              { w: 32, h: 142, tone: 4 },
            ]}
          />
        </div>
      </aside>

      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))] md:max-w-sm md:px-0">
        <div className="flex flex-col gap-5 md:hidden">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <Wordmark />
          </div>
          <SpineRow
            spines={[
              { w: 22, h: 70, tone: 1 },
              { w: 18, h: 56, tone: 3 },
              { w: 26, h: 82, tone: 2 },
              { w: 20, h: 64, tone: 5 },
              { w: 24, h: 76, tone: 4 },
              { w: 18, h: 58, tone: 1 },
            ]}
          />
        </div>
        {children}
      </main>
    </div>
  );
}
