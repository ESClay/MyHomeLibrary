"use client";

import { useActionState, useState } from "react";
import { changePriceRegion } from "./actions";
import { saveRegion } from "../region/actions";
import type { ActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { LOCALES, REGIONS, currencyLabel, getRegion } from "@/lib/regions";

function Message({ state, done }: { state: ActionState; done: string }) {
  if (state.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.error}
      </p>
    );
  return state.saved ? <p role="status" className="text-sm text-muted-foreground">{done}</p> : null;
}

/** Your own region and language: where you are, and how dates and numbers read. */
export function RegionForm({ region, locale }: { region: string; locale: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => ({ ...(await saveRegion(prev, fd)), saved: true }), {});
  const known = LOCALES.some((l) => l.tag === locale);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="my-region">Region</Label>
          <NativeSelect id="my-region" name="region" defaultValue={region}>
            {REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.country} · {r.currency}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="my-locale">Language and formats</Label>
          <NativeSelect id="my-locale" name="locale" defaultValue={locale}>
            {!known && <option value={locale}>{locale}</option>}
            {LOCALES.map((l) => (
              <option key={l.tag} value={l.tag}>
                {l.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">This is just for you. It changes how dates, numbers and prices read, not which currency the library prices in.</p>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? "Saving…" : "Save"}
        </Button>
        <Message state={state} done="Saved." />
      </div>
    </form>
  );
}

/** The library's price region (owner). Changing it asks first, because prices will be fetched again in the new currency. */
export function PriceRegionForm({ libraryId, priceRegion, locale }: { libraryId: string; priceRegion: string | null; locale: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => ({ ...(await changePriceRegion(prev, fd)), saved: true }), {});
  const [choice, setChoice] = useState(priceRegion ?? "");
  const [confirming, setConfirming] = useState(false);
  const current = getRegion(priceRegion);
  const next = getRegion(choice);
  const changed = !!next && next.id !== priceRegion;

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="libraryId" value={libraryId} />
      <input type="hidden" name="priceRegion" value={choice} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="price-region">Price region</Label>
        <NativeSelect
          id="price-region"
          value={choice}
          onChange={(e) => {
            setChoice(e.target.value);
            setConfirming(false);
          }}
        >
          {!priceRegion && (
            <option value="" disabled>
              Not set: prices are off
            </option>
          )}
          {REGIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.country} · {r.currency}
            </option>
          ))}
        </NativeSelect>
        <p className="text-sm text-muted-foreground">
          {current
            ? `Prices in this library are in ${currencyLabel(current.currency, locale)} and looked up on ${current.domain}.`
            : "Until you choose a region, this library shows no prices and no price checks run."}
        </p>
      </div>

      {changed && !confirming && (
        <Button type="button" variant="outline" className="w-fit" onClick={() => setConfirming(true)}>
          Change price region
        </Button>
      )}

      {changed && confirming && next && (
        <div role="alertdialog" aria-label="Confirm price region change" className="panel flex flex-col gap-3 border-gilt p-4">
          <p className="text-[0.9375rem]">
            {current
              ? `Prices will be fetched again in ${currencyLabel(next.currency, locale)}. Current prices in ${current.currency} stay on your copies, marked as the old currency, until each is checked again. Paid prices are not converted.`
              : `Prices will start in ${currencyLabel(next.currency, locale)} on the next price check.`}
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Changing…" : `Yes, use ${next.currency}`}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Keep {current?.currency ?? "it as is"}
            </Button>
          </div>
        </div>
      )}
      <Message state={state} done="Price region updated." />
    </form>
  );
}
