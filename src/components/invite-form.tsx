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
        <Input id="invite-email" name="email" type="email" required className="h-10 text-base" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-role">Role</Label>
        <select
          id="invite-role"
          name="role"
          defaultValue="editor"
          className="h-10 rounded-lg border border-input bg-transparent px-2.5 text-base"
        >
          <option value="editor">Editor (can add and edit books)</option>
          <option value="viewer">Viewer (read only)</option>
        </select>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" className="h-10" disabled={pending}>
        {pending ? "Creating…" : "Create invite link"}
      </Button>
    </form>
  );
}
