"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createInvite } from "@/app/(app)/settings/actions";
import type { ActionState } from "@/app/(app)/actions";

export function InviteForm({ libraryId }: { libraryId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createInvite, {});

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="libraryId" value={libraryId} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-email">Email</Label>
        <Input id="invite-email" name="email" type="email" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-role">Role</Label>
        <select
          id="invite-role"
          name="role"
          defaultValue="editor"
          className="h-11 rounded-lg border border-input bg-card px-3 text-base text-foreground shadow-[inset_0_1px_2px_rgb(40_25_10/0.06)] transition-[border-color] duration-[var(--dur-fast)] outline-none hover:border-foreground/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <option value="editor">Editor (can add and edit books)</option>
          <option value="viewer">Viewer (read only)</option>
        </select>
      </div>
      {state.error && (
        <p role="alert" className="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create invite link"}
      </Button>
    </form>
  );
}
