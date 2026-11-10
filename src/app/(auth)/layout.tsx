import { BookOpen } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-center gap-2">
        <BookOpen className="size-6" aria-hidden />
        <span className="text-xl font-semibold">MyHomeLibrary</span>
      </div>
      {children}
    </main>
  );
}
