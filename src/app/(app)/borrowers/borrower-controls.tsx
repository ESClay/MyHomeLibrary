"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { addBorrower, deleteBorrower } from "@/app/(app)/loans/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function BorrowerAdd({ libraryId }: { libraryId: string }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await addBorrower({ libraryId, name, note });
          if (res.ok) {
            setName("");
            setNote("");
          } else setError(res.error);
        });
      }}
    >
      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor="borrower-name">Add someone</Label>
        <Input id="borrower-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoComplete="off" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor="borrower-note">Note (optional)</Label>
        <Input id="borrower-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} autoComplete="off" />
      </div>
      <Button type="submit" disabled={pending || !name.trim()}>
        <Plus aria-hidden /> {pending ? "Adding…" : "Add"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive sm:basis-full">
          {error}
        </p>
      )}
    </form>
  );
}

export function BorrowerDelete({ borrowerId, name }: { borrowerId: string; name: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Remove ${name} from the list`}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await deleteBorrower(borrowerId);
            if (!res.ok) setError(res.error);
          })
        }
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
