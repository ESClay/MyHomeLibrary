"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { createShelf, listAssignableShelves, type AssignableShelf } from "@/app/(app)/shelves/actions";
import { PrivateMark, ShelfBadge } from "@/components/shelf-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LibraryRole } from "@/lib/library";
import { cn } from "@/lib/utils";

/**
 * Pick any number of manual shelves. Loads the shelves this person may use (shared and their own
 * private ones, lock-marked) and can make a new one on the spot. The parent owns the chosen ids.
 */
export function ShelfList({
  libraryId,
  value,
  onChange,
  disabled,
  exclude,
  allowCreate = true,
}: {
  libraryId: string;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  /** Shelf ids to hide (already on them). */
  exclude?: string[];
  allowCreate?: boolean;
}) {
  const [shelves, setShelves] = useState<AssignableShelf[] | null>(null);
  const [role, setRole] = useState<LibraryRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [priv, setPriv] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    listAssignableShelves(libraryId)
      .then((r) => {
        if (!live) return;
        if (r.ok) {
          setShelves(r.shelves);
          setRole(r.role);
        } else setError(r.error);
      })
      .catch(() => live && setError("Your shelves could not be loaded."));
    return () => {
      live = false;
    };
  }, [libraryId]);

  const canShare = role === "owner" || role === "editor";
  const visible = (shelves ?? []).filter((s) => !exclude?.includes(s.id));

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  function create() {
    const n = name.trim();
    if (!n) return;
    setError(null);
    start(async () => {
      const res = await createShelf({ libraryId, name: n, visibility: canShare && !priv ? "shared" : "private" });
      if (!res.ok) return setError(res.error);
      const list = await listAssignableShelves(libraryId);
      if (list.ok) setShelves(list.shelves);
      onChange([...value, res.id]);
      setName("");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {shelves === null && !error && <p className="text-sm text-muted-foreground">Loading shelves…</p>}
      {shelves !== null && visible.length === 0 && (
        <p className="text-sm text-muted-foreground">{shelves.length === 0 ? "No shelves yet. Make the first one below." : "It is on every shelf you can use."}</p>
      )}
      {visible.length > 0 && (
        <ul className="flex flex-wrap gap-2" role="group" aria-label="Shelves">
          {visible.map((s) => {
            const on = value.includes(s.id);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => toggle(s.id)}
                  className={cn(
                    "flex min-h-11 max-w-full cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-left text-[0.9375rem] font-medium transition-[border-color,background-color,transform] duration-[var(--dur-fast)] active:translate-y-px disabled:opacity-50",
                    on ? "border-primary bg-primary/10" : "border-input bg-card hover:border-foreground/40",
                  )}
                >
                  <ShelfBadge color={s.color} icon={s.icon} className="size-6" />
                  <span className="truncate">{s.name}</span>
                  {s.visibility === "private" && <PrivateMark />}
                  <Check aria-hidden className={cn("size-4 shrink-0 text-primary", on ? "opacity-100" : "opacity-0")} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {allowCreate && role && (
        <form
          className="flex flex-col gap-2 rounded-lg border border-dashed border-input p-3"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            New shelf
            <span className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Name it, e.g. Bedside" autoComplete="off" disabled={disabled || pending} className="font-normal" />
              <Button type="submit" variant="outline" disabled={disabled || pending || !name.trim()}>
                <Plus aria-hidden /> {pending ? "Adding…" : "Add"}
              </Button>
            </span>
          </label>
          {canShare ? (
            <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={priv} onChange={(e) => setPriv(e.target.checked)} />
              Private: only I can see it
            </label>
          ) : (
            <p className="text-sm text-muted-foreground">As a viewer your new shelves are private to you.</p>
          )}
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** The collapsible “Put on shelves” control used by the three add-review screens. */
export function ShelfPicker({
  libraryId,
  value,
  onChange,
  disabled,
}: {
  libraryId: string;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="put-on-shelves"
        onClick={() => setOpen((o) => !o)}
        className="-my-1 flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-lg text-left"
      >
        <span className="flex flex-col">
          <span className="text-sm font-semibold">Put on shelves</span>
          <span className="text-sm text-muted-foreground">
            {value.length === 0 ? "Optional. Every saved book goes on the shelves you pick." : `Every saved book goes on ${value.length} ${value.length === 1 ? "shelf" : "shelves"}.`}
          </span>
        </span>
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 transition-transform duration-[var(--dur)]", open && "rotate-180")} />
      </button>
      <div id="put-on-shelves" hidden={!open}>
        {open && <ShelfList libraryId={libraryId} value={value} onChange={onChange} disabled={disabled} />}
      </div>
    </div>
  );
}
