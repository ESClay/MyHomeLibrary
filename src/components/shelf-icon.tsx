import { Armchair, BookOpen, Bookmark, Coffee, Feather, Gift, GraduationCap, Heart, Lamp, Moon, Sprout, Star, Lock, type LucideIcon } from "lucide-react";
import { SHELF_COLOR_BG, SHELF_ICON_KEYS, SHELF_ICON_LABEL, type ShelfColor, type ShelfIconKey } from "@/lib/shelves/constants";
import { cn } from "@/lib/utils";

const ICONS: Record<ShelfIconKey, LucideIcon> = {
  "book-open": BookOpen,
  bookmark: Bookmark,
  armchair: Armchair,
  lamp: Lamp,
  coffee: Coffee,
  moon: Moon,
  feather: Feather,
  star: Star,
  heart: Heart,
  gift: Gift,
  "graduation-cap": GraduationCap,
  sprout: Sprout,
};

export const isShelfIcon = (k: string | null): k is ShelfIconKey => !!k && (SHELF_ICON_KEYS as readonly string[]).includes(k);

export function ShelfIconGlyph({ icon, className }: { icon: string | null; className?: string }) {
  const Icon = isShelfIcon(icon) ? ICONS[icon] : BookOpen;
  return <Icon aria-hidden className={cn("size-4", className)} />;
}

export const shelfIconLabel = (k: ShelfIconKey) => SHELF_ICON_LABEL[k];

/** A small spine-coloured tab carrying the shelf's icon. Decorative. */
export function ShelfBadge({ color, icon, className }: { color: ShelfColor; icon: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-[4px] text-white shadow-[inset_2px_0_0_rgb(255_255_255/0.16),inset_-2px_0_0_rgb(0_0_0/0.14)]",
        SHELF_COLOR_BG[color],
        className,
      )}
    >
      <ShelfIconGlyph icon={icon} className="size-3.5" />
    </span>
  );
}

export function PrivateMark({ className }: { className?: string }) {
  return (
    <span title="Private: only you see this shelf" className={cn("inline-flex text-muted-foreground", className)}>
      <Lock className="size-3.5" aria-hidden />
      <span className="sr-only">Private shelf</span>
    </span>
  );
}
