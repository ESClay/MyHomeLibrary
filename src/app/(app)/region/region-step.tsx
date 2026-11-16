"use client";

import { useActionState } from "react";
import { saveRegion } from "./actions";
import type { ActionState } from "../actions";
import { RegionSelect } from "@/components/region-select";
import { Button } from "@/components/ui/button";

export function RegionStepForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveRegion, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <RegionSelect />
      {state.error && (
        <p role="alert" className="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving…" : "Continue"}
      </Button>
    </form>
  );
}
