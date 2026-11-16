"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Users } from "lucide-react";
import { createShelf, updateShelf } from "@/app/(app)/shelves/actions";
import { Field } from "@/components/book-forms";
import { ShelfIconGlyph, shelfIconLabel } from "@/components/shelf-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  SHELF_COLORS,
  SHELF_COLOR_BG,
  SHELF_COLOR_LABEL,
  SHELF_ICON_KEYS,
  SHELF_SORTS,
  SHELF_SORT_LABEL,
  type ShelfColor,
  type ShelfSort,
  type ShelfVisibility,
} from "@/lib/shelves/constants";
import { describeRules, type ShelfRules } from "@/lib/shelves/rules";
import { cn } from "@/lib/utils";

export type ShelfFormValues = {
  name: string;
  visibility: ShelfVisibility;
  color: ShelfColor;
  icon: string | null;
  sort: ShelfSort;
};

export const NEW_SHELF: ShelfFormValues = { name: "", visibility: "shared", color: "spine-1", icon: null, sort: "series" };

/** Make a shelf, or change one's name, visibility, colour, icon and order. A smart shelf also shows its rules. */
export function ShelfFormSheet({
  libraryId,
  shelfId,
  initial,
  rules,
  canShare,
  onClose,
}: {
  libraryId: string;
  /** Present when editing. */
  shelfId?: string;
  initial: ShelfFormValues;
  /** Present for a smart shelf (new or existing). */
  rules?: ShelfRules;
  /** False for viewers, who can only make private shelves. */
  canShare: boolean;
  onClose: (savedId?: string) => void;
}) {
  const router = useRouter();
  const [v, setV] = useState<ShelfFormValues>(canShare || shelfId ? initial : { ...initial, visibility: "private" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const smart = !!rules;
  const sorts = SHELF_SORTS.filter((s) => !(smart && s === "custom"));
  const set = (patch: Partial<ShelfFormValues>) => setV((p) => ({ ...p, ...patch }));
  const icon = v.icon as (typeof SHELF_ICON_KEYS)[number] | null;

  function save() {
    setError(null);
    start(async () => {
      if (shelfId) {
        const res = await updateShelf({ shelfId, name: v.name, visibility: v.visibility, color: v.color, icon, sort: v.sort });
        if (!res.ok) return setError(res.error);
        router.refresh();
        onClose(shelfId);
      } else {
        const res = await createShelf({ libraryId, name: v.name, visibility: v.visibility, color: v.color, icon, sort: v.sort, rules: rules ?? null });
        if (!res.ok) return setError(res.error);
        router.refresh();
        onClose(res.id);
      }
    });
  }

  const chips = rules ? describeRules(rules) : [];

  return (
    <Sheet open onOpenChange={(o) => !o && !pending && onClose()}>
      <SheetContent title={shelfId ? "Edit shelf" : smart ? "New smart shelf" : "New shelf"} description={smart ? "Fills itself from the filters below." : undefined}>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
            <Field label="Name">
              {(id) => <Input id={id} value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={100} autoComplete="off" autoFocus={!shelfId} placeholder="Living room, Bedside, To lend" />}
            </Field>

            {smart && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold">Rules</p>
                <ul className="flex flex-wrap gap-1.5">
                  {chips.map((c) => (
                    <li key={c.key} className="rounded-md border border-border bg-accent px-2 py-1 text-sm">
                      {c.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">Who sees it</legend>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Who sees it">
                {(
                  [
                    ["shared", Users, "Everyone in the library"],
                    ["private", Lock, "Only me"],
                  ] as const
                ).map(([val, Icon, label]) => {
                  const blocked = val === "shared" && !canShare;
                  return (
                    <label key={val} className={cn("cursor-pointer", blocked && "cursor-not-allowed opacity-50")}>
                      <input type="radio" name="visibility" className="peer sr-only" checked={v.visibility === val} disabled={blocked} onChange={() => set({ visibility: val })} />
                      <span className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-input bg-card px-2 text-center text-sm font-medium transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                        <Icon aria-hidden className="size-4 shrink-0" /> {label}
                      </span>
                    </label>
                  );
                })}
              </div>
              {!canShare && <p className="text-sm text-muted-foreground">Viewers can make private shelves. Owners and editors can also share them.</p>}
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">Spine colour</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Spine colour">
                {SHELF_COLORS.map((c) => (
                  <label key={c} className="cursor-pointer">
                    <input type="radio" name="color" className="peer sr-only" checked={v.color === c} onChange={() => set({ color: c })} />
                    <span
                      title={SHELF_COLOR_LABEL[c]}
                      className={cn(
                        "flex size-11 items-center justify-center rounded-[6px] ring-offset-2 ring-offset-card transition-shadow peer-checked:ring-2 peer-checked:ring-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                        SHELF_COLOR_BG[c],
                      )}
                    >
                      <span className="sr-only">{SHELF_COLOR_LABEL[c]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">Icon (optional)</legend>
              <div className="grid grid-cols-6 gap-2" role="radiogroup" aria-label="Icon">
                <label className="cursor-pointer">
                  <input type="radio" name="icon" className="peer sr-only" checked={v.icon === null} onChange={() => set({ icon: null })} />
                  <span className="flex h-11 items-center justify-center rounded-lg border border-input bg-card text-xs font-medium peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">None</span>
                </label>
                {SHELF_ICON_KEYS.map((k) => (
                  <label key={k} className="cursor-pointer">
                    <input type="radio" name="icon" className="peer sr-only" checked={v.icon === k} onChange={() => set({ icon: k })} />
                    <span title={shelfIconLabel(k)} className="flex h-11 items-center justify-center rounded-lg border border-input bg-card peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                      <ShelfIconGlyph icon={k} />
                      <span className="sr-only">{shelfIconLabel(k)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <Field label="Order books by" hint={smart ? undefined : "“My own order” lets you drag books into place."}>
              {(id) => (
                <NativeSelect id={id} value={v.sort} onChange={(e) => set({ sort: e.target.value as ShelfSort })}>
                  {sorts.map((s) => (
                    <option key={s} value={s}>
                      {SHELF_SORT_LABEL[s]}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <div className="border-t border-border bg-card px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button type="submit" size="lg" className="w-full" disabled={pending || !v.name.trim()}>
              {pending ? "Saving…" : shelfId ? "Save changes" : "Create shelf"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
