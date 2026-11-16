"use client";

import { useEffect, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { REGIONS, getRegion, guessRegion, localeForRegion } from "@/lib/regions";

/**
 * A region picker for sign-up and the "Choose your region" step. It guesses from the browser's language and time zone once the page
 * is on the client (so the server render is the same for everyone), unless the person has already picked something.
 * Submits `region` and a matching `locale`.
 */
export function RegionSelect({ defaultRegion, id = "region" }: { defaultRegion?: string | null; id?: string }) {
  const [region, setRegion] = useState(defaultRegion ?? "");
  const [browserLocale, setBrowserLocale] = useState<string | null>(null);
  const touched = useRef(false);

  useEffect(() => {
    const lang = navigator.language;
    // Reading the browser is only possible here, after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBrowserLocale(lang);
    if (defaultRegion || touched.current) return;
    const guess = guessRegion(lang, Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (guess) setRegion((current) => current || guess.id);
  }, [defaultRegion]);

  const chosen = getRegion(region);
  const locale = chosen ? localeForRegion(chosen, browserLocale) : "";

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Region</Label>
      <NativeSelect
        id={id}
        name="region"
        required
        value={region}
        onChange={(e) => {
          touched.current = true;
          setRegion(e.target.value);
        }}
      >
        <option value="" disabled>
          Choose your region
        </option>
        {REGIONS.map((r) => (
          <option key={r.id} value={r.id}>
            {r.country} · {r.currency}
          </option>
        ))}
      </NativeSelect>
      <input type="hidden" name="locale" value={locale} />
      <p className="text-xs text-muted-foreground">Sets your currency, dates and where we look up what books sell for. Change it any time in Settings.</p>
    </div>
  );
}
