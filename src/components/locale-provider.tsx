"use client";

import { createContext, useContext } from "react";
import { DEFAULT_LOCALE } from "@/lib/regions";

const LocaleContext = createContext<string>(DEFAULT_LOCALE);

/** The signed-in person's locale, so client components format dates and money the way the server did. */
export function LocaleProvider({ locale, children }: { locale: string; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export const useLocale = () => useContext(LocaleContext);
