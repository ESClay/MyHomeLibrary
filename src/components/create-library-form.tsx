"use client";

import { useActionState } from "react";
import { createLibrary, type ActionState } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateLibraryForm({ submitLabel = "Create library" }: { submitLabel?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createLibrary, {});

  return (
    <form action={action} className="flex flex-col gap-3">
      <Label htmlFor="library-name">Library name</Label>
      <Input
        id="library-name"
        name="name"
        required
        maxLength={100}
        placeholder="Our home library"
        className="h-10 text-base"
      />
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" className="h-10" disabled={pending}>
        {pending ? "Creating…" : submitLabel}
      </Button>
    </form>
  );
}
