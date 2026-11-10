"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Compass, Library, Plus, User } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/library", label: "Library", icon: BookOpen },
  { href: "/shelves", label: "Shelves", icon: Library },
  { href: "/add", label: "Add", icon: Plus, primary: true },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/settings", label: "Profile", icon: User },
] as const;

function useActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomTabs() {
  const isActive = useActive();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-5">
        {items.map(({ href, label, icon: Icon, ...rest }) => {
          const active = isActive(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-xs",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {"primary" in rest ? (
                  <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Icon className="size-5" aria-hidden />
                    <span className="sr-only">{label}</span>
                  </span>
                ) : (
                  <>
                    <Icon className="size-5" aria-hidden />
                    {label}
                  </>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SidebarNav() {
  const isActive = useActive();

  return (
    <nav aria-label="Primary">
      <ul className="flex flex-col gap-1">
        {items.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted",
                  active ? "bg-muted text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
