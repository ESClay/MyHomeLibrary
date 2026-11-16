import { BrandMark, Wordmark } from "@/components/brand";
import { SpineRow } from "@/components/shelf";
import { CreateLibraryForm } from "@/components/create-library-form";
import { LibrarySwitcher } from "@/components/library-switcher";
import { BottomTabs, SidebarNav } from "@/components/nav";
import { getLibraryContext } from "@/lib/library";
import { signOut } from "../(auth)/actions";
import { Button } from "@/components/ui/button";
import { LocaleProvider } from "@/components/locale-provider";
import { RegionStepForm } from "./region/region-step";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { libraries, current, region, locale } = await getLibraryContext();

  // One-time step for OAuth sign-ups and accounts from before regions existed. Nothing else renders until it is done,
  // so no page ever runs without a currency and locale; sign-out stays reachable.
  if (!region) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <Wordmark />
        </div>
        <div className="rise flex flex-col gap-2">
          <p className="eyebrow text-gilt">One quick thing</p>
          <h1 className="page-title">Choose your region</h1>
          <p className="text-base text-muted-foreground">
            It sets the currency your prices show in and how dates and numbers read. Your library prices follow it too.
          </p>
        </div>
        <RegionStepForm />
        <form action={signOut} className="border-t border-border pt-4">
          <Button type="submit" variant="ghost" className="-ml-3">
            Sign out instead
          </Button>
        </form>
      </main>
    );
  }

  if (!current) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
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
          ]}
          gap={4}
        />
        <div className="rise flex flex-col gap-2">
          <p className="eyebrow text-gilt">First shelf</p>
          <h1 className="page-title">Create your first library</h1>
          <p className="text-base text-muted-foreground">
            A library holds your books and can be shared with family. You can add more later.
          </p>
        </div>
        <CreateLibraryForm />
      </main>
    );
  }

  return (
    <LocaleProvider locale={locale}>
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-8 border-r border-sidebar-border bg-sidebar p-5 md:flex">
        <div className="flex items-center gap-2.5 px-1 pt-1">
          <BrandMark />
          <Wordmark />
        </div>
        <LibrarySwitcher libraries={libraries} currentId={current.id} />
        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b bg-background/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
          <div className="flex h-14 items-center gap-3">
            <BrandMark className="size-8" />
            <LibrarySwitcher libraries={libraries} currentId={current.id} />
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-10 md:py-10 md:pb-10">
          {children}
        </main>
      </div>

      <BottomTabs />
    </div>
    </LocaleProvider>
  );
}
