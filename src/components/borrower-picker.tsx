"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { BorrowerChoice } from "@/lib/loans/schemas";
import { useId } from "react";

export type BorrowerOption = { id: string; name: string };
export type BorrowerState = { pick: string; name: string; note: string };
export const NEW_BORROWER = "__new";
export const emptyBorrower: BorrowerState = { pick: "", name: "", note: "" };

/** The server-action input for what the picker holds, or null while nothing valid is chosen. */
export function borrowerChoice(s: BorrowerState): BorrowerChoice | null {
  if (s.pick === NEW_BORROWER) return s.name.trim() ? { newName: s.name.trim(), newNote: s.note.trim() || undefined } : null;
  return s.pick ? { borrowerId: s.pick } : null;
}

/** Pick someone from the library's borrowers list, or add a new person without leaving the sheet. */
export function BorrowerPicker({
  borrowers,
  value,
  onChange,
  label,
}: {
  borrowers: BorrowerOption[];
  value: BorrowerState;
  onChange: (next: BorrowerState) => void;
  label: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <NativeSelect id={id} value={value.pick} onChange={(e) => onChange({ ...value, pick: e.target.value })}>
          <option value="" disabled>
            Choose a person
          </option>
          {borrowers.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
          <option value={NEW_BORROWER}>+ Add someone new</option>
        </NativeSelect>
      </div>
      {value.pick === NEW_BORROWER && (
        <div className="panel flex flex-col gap-3 p-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input id={`${id}-name`} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} maxLength={100} autoComplete="off" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-note`}>Note (optional)</Label>
            <Input id={`${id}-note`} value={value.note} onChange={(e) => onChange({ ...value, note: e.target.value })} maxLength={500} placeholder="Neighbour, book club…" autoComplete="off" />
          </div>
        </div>
      )}
    </div>
  );
}
