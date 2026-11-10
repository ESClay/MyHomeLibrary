import { BookOpen } from "lucide-react";
import { CreateLibraryForm } from "@/components/create-library-form";
import { LibrarySwitcher } from "@/components/library-switcher";
import { BottomTabs, SidebarNav } from "@/components/nav";
import { getLibraryContext } from "@/lib/library";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { libraries, current } = await getLibraryContext();

  if (!current) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-2xl font-semibold">Create your first library</h1>
          <p className="text-sm text-muted-foreground">
            A library holds your books and can be shared with family. You can add more later.
          </p>
        </div>
        <CreateLibraryForm />
      </main>
    );
  }

  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 border-r p-4 md:flex">
        <div className="flex items-center gap-2 px-1">
          <BookOpen className="size-5" aria-hidden />
          <span className="font-semibold">MyHomeLibrary</span>
        </div>
        <LibrarySwitcher libraries={libraries} currentId={current.id} />
        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b bg-background px-4 pt-[env(safe-area-inset-top)] md:hidden">
          <div className="flex h-12 items-center">
            <LibrarySwitcher libraries={libraries} currentId={current.id} />
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 py-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-8 md:py-8 md:pb-8">
          {children}
        </main>
      </div>

      <BottomTabs />
    </div>
  );
}
