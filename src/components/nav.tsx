"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, BookOpen, Compass, Library, Plus, User } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/library", label: "Library", icon: BookOpen },
  { href: "/shelves", label: "Shelves", icon: Library },
  { href: "/add", label: "Add", icon: Plus, primary: true },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/settings", label: "Profile", icon: User },
] as const;

/** The desktop sidebar has room for Stats; on phones it is reached from Profile, so the five tabs stay uncrowded. */
const sidebarItems = [...items.slice(0, 5), { href: "/stats", label: "Stats", icon: BarChart3 }, items[5]] as const;

/** Finished jobs nobody has opened yet, as a small count on the Activity item. Zero shows nothing. */
function UnseenBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gilt px-1.5 text-[0.6875rem] leading-none font-semibold text-background tabular-nums", className)}
    >
      <span aria-hidden>{count > 9 ? "9+" : count}</span>
      <span className="sr-only">{count} finished, not yet reviewed</span>
    </span>
  );
}

function useActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomTabs({ unseen = 0 }: { unseen?: number }) {
  const isActive = useActive();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-6 px-1">
        {items.map(({ href, label, icon: Icon, ...rest }) => {
          const active = isActive(href);
          const primary = "primary" in rest;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors duration-[var(--dur-fast)]",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {primary ? (
                  <span
                    className={cn(
                      "-mt-6 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[inset_0_-3px_0_rgb(0_0_0/0.22),0_8px_16px_-6px_rgb(40_25_10/0.55)] ring-4 ring-background transition-transform duration-[var(--dur-fast)] ease-[var(--ease)] group-hover:-translate-y-0.5 group-active:translate-y-px group-active:scale-95",
                      active && "ring-gilt/60",
                    )}
                  >
                    <Icon className="size-6" strokeWidth={2} aria-hidden />
                    <span className="sr-only">{label}</span>
                  </span>
                ) : (
                  <>
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-0 h-0.5 w-8 rounded-full bg-gilt transition-opacity duration-[var(--dur)]",
                        active ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="relative">
                      <Icon className="size-[1.375rem]" strokeWidth={active ? 2 : 1.6} aria-hidden />
                      {href === "/activity" && <UnseenBadge count={unseen} className="absolute -top-2 left-3 h-4 min-w-4 px-1 text-[0.625rem] ring-2 ring-background" />}
                    </span>
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

export function SidebarNav({ unseen = 0 }: { unseen?: number }) {
  const isActive = useActive();

  return (
    <nav aria-label="Primary">
      <ul className="flex flex-col gap-1">
        {sidebarItems.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-11 items-center gap-3 rounded-lg px-3 text-[0.9375rem] font-medium transition-[background-color,color,transform] duration-[var(--dur-fast)] hover:bg-sidebar-accent/70 active:translate-y-px",
                  active ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-2.5 bottom-2.5 left-0 w-0.5 rounded-full bg-gilt transition-opacity duration-[var(--dur)]",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
                <Icon className="size-[1.125rem]" strokeWidth={active ? 2 : 1.6} aria-hidden />
                {label}
                {href === "/activity" && <UnseenBadge count={unseen} className="ml-auto" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
