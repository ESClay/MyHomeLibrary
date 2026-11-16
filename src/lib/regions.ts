/**
 * Regions: the eBay marketplaces where the Browse API works, each with its currency and a default locale.
 *
 * Source: eBay Buy APIs "Supported marketplaces" reference
 * (https://developer.ebay.com/api-docs/buy/static/ref-marketplace-supported.html), which lists the values the
 * `X-EBAY-C-MARKETPLACE-ID` header accepts: AT, AU, BE, CA, CH, DE, ES, FR, GB, HK, IE, IT, NL, PL, SG and US.
 * Currency and default locale are ours (each marketplace's own site currency). Pure and client-safe.
 */

export type Region = {
  /** The `X-EBAY-C-MARKETPLACE-ID` value, also what we store on profiles.region and libraries.price_region. */
  id: string;
  country: string;
  /** Default BCP-47 locale for the region. */
  locale: string;
  /** ISO 4217 */
  currency: string;
  /** The marketplace's site */
  domain: string;
};

export const REGIONS: readonly Region[] = [
  { id: "EBAY_US", country: "United States", locale: "en-US", currency: "USD", domain: "ebay.com" },
  { id: "EBAY_CA", country: "Canada", locale: "en-CA", currency: "CAD", domain: "ebay.ca" },
  { id: "EBAY_GB", country: "United Kingdom", locale: "en-GB", currency: "GBP", domain: "ebay.co.uk" },
  { id: "EBAY_AU", country: "Australia", locale: "en-AU", currency: "AUD", domain: "ebay.com.au" },
  { id: "EBAY_IE", country: "Ireland", locale: "en-IE", currency: "EUR", domain: "ebay.ie" },
  { id: "EBAY_DE", country: "Germany", locale: "de-DE", currency: "EUR", domain: "ebay.de" },
  { id: "EBAY_FR", country: "France", locale: "fr-FR", currency: "EUR", domain: "ebay.fr" },
  { id: "EBAY_IT", country: "Italy", locale: "it-IT", currency: "EUR", domain: "ebay.it" },
  { id: "EBAY_ES", country: "Spain", locale: "es-ES", currency: "EUR", domain: "ebay.es" },
  { id: "EBAY_NL", country: "Netherlands", locale: "nl-NL", currency: "EUR", domain: "ebay.nl" },
  { id: "EBAY_BE", country: "Belgium", locale: "nl-BE", currency: "EUR", domain: "ebay.be" },
  { id: "EBAY_AT", country: "Austria", locale: "de-AT", currency: "EUR", domain: "ebay.at" },
  { id: "EBAY_CH", country: "Switzerland", locale: "de-CH", currency: "CHF", domain: "ebay.ch" },
  { id: "EBAY_PL", country: "Poland", locale: "pl-PL", currency: "PLN", domain: "ebay.pl" },
  { id: "EBAY_HK", country: "Hong Kong", locale: "zh-HK", currency: "HKD", domain: "ebay.com.hk" },
  { id: "EBAY_SG", country: "Singapore", locale: "en-SG", currency: "SGD", domain: "ebay.com.sg" },
];

export const DEFAULT_REGION_ID = "EBAY_US";
export const DEFAULT_LOCALE = "en-US";

const BY_ID = new Map(REGIONS.map((r) => [r.id, r]));
const BY_COUNTRY_CODE = new Map(REGIONS.map((r) => [r.id.slice(5), r]));

export function isRegionId(v: unknown): v is string {
  return typeof v === "string" && BY_ID.has(v);
}

export function getRegion(id: string | null | undefined): Region | null {
  return (id && BY_ID.get(id)) || null;
}

/** The currency a marketplace prices in, or null for an unknown or missing region. */
export function currencyFor(regionId: string | null | undefined): string | null {
  return getRegion(regionId)?.currency ?? null;
}

/** A locale offered in the language picker. Includes Canadian French, which has no marketplace of its own. */
export const LOCALES: readonly { tag: string; label: string }[] = [
  { tag: "en-US", label: "English (United States)" },
  { tag: "en-CA", label: "English (Canada)" },
  { tag: "en-GB", label: "English (United Kingdom)" },
  { tag: "en-AU", label: "English (Australia)" },
  { tag: "en-IE", label: "English (Ireland)" },
  { tag: "en-SG", label: "English (Singapore)" },
  { tag: "fr-CA", label: "Français (Canada)" },
  { tag: "fr-FR", label: "Français (France)" },
  { tag: "de-DE", label: "Deutsch (Deutschland)" },
  { tag: "de-AT", label: "Deutsch (Österreich)" },
  { tag: "de-CH", label: "Deutsch (Schweiz)" },
  { tag: "it-IT", label: "Italiano" },
  { tag: "es-ES", label: "Español" },
  { tag: "nl-NL", label: "Nederlands (Nederland)" },
  { tag: "nl-BE", label: "Nederlands (België)" },
  { tag: "pl-PL", label: "Polski" },
  { tag: "zh-HK", label: "中文 (香港)" },
];

/** True for a well-formed BCP-47 tag that `Intl` accepts. */
export function isLocale(v: unknown): v is string {
  if (typeof v !== "string" || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v)) return false;
  try {
    return Intl.getCanonicalLocales(v).length === 1;
  } catch {
    return false;
  }
}

export function localeOrDefault(v: string | null | undefined): string {
  return v && isLocale(v) ? v : DEFAULT_LOCALE;
}

/** Time zones that point at a marketplace more reliably than the browser language does. */
const TIMEZONE_REGION: [prefix: string, regionId: string][] = [
  ["America/Toronto", "EBAY_CA"],
  ["America/Vancouver", "EBAY_CA"],
  ["America/Edmonton", "EBAY_CA"],
  ["America/Winnipeg", "EBAY_CA"],
  ["America/Halifax", "EBAY_CA"],
  ["America/St_Johns", "EBAY_CA"],
  ["America/Regina", "EBAY_CA"],
  ["America/Montreal", "EBAY_CA"],
  ["America/", "EBAY_US"],
  ["Pacific/Honolulu", "EBAY_US"],
  ["Europe/London", "EBAY_GB"],
  ["Europe/Dublin", "EBAY_IE"],
  ["Europe/Berlin", "EBAY_DE"],
  ["Europe/Paris", "EBAY_FR"],
  ["Europe/Rome", "EBAY_IT"],
  ["Europe/Madrid", "EBAY_ES"],
  ["Europe/Amsterdam", "EBAY_NL"],
  ["Europe/Brussels", "EBAY_BE"],
  ["Europe/Vienna", "EBAY_AT"],
  ["Europe/Zurich", "EBAY_CH"],
  ["Europe/Warsaw", "EBAY_PL"],
  ["Asia/Hong_Kong", "EBAY_HK"],
  ["Asia/Singapore", "EBAY_SG"],
  ["Australia/", "EBAY_AU"],
];

function regionFromTimezone(tz: string | null | undefined): Region | null {
  if (!tz) return null;
  for (const [prefix, id] of TIMEZONE_REGION) {
    if (prefix.endsWith("/") ? tz.startsWith(prefix) : tz === prefix) return getRegion(id);
  }
  return null;
}

function localeCountry(locale: string | null | undefined): string | null {
  if (!locale) return null;
  try {
    return new Intl.Locale(locale).region ?? null;
  } catch {
    return null;
  }
}

/**
 * Best guess at someone's marketplace from the browser locale (`navigator.language`) and time zone.
 * A locale with a country we serve wins (en-CA, de-AT, fr-FR). A plain `en-US` is the browser default for
 * many people elsewhere, so there the time zone decides when it points at another marketplace.
 * Returns null when nothing matches, so the form can leave the choice open.
 */
export function guessRegion(locale: string | null | undefined, timeZone: string | null | undefined): Region | null {
  const country = localeCountry(locale);
  const byLocale = country ? (BY_COUNTRY_CODE.get(country) ?? null) : null;
  const byZone = regionFromTimezone(timeZone);
  if (byLocale && byLocale.id !== "EBAY_US") return byLocale;
  if (byZone) return byZone;
  if (byLocale) return byLocale;
  // A bare language: English with no country is most likely US; other languages point at one home market.
  let language: string | null = null;
  try {
    language = locale ? new Intl.Locale(locale).language : null;
  } catch {
    language = null;
  }
  const byLanguage: Record<string, string> = { en: "EBAY_US", de: "EBAY_DE", fr: "EBAY_FR", it: "EBAY_IT", es: "EBAY_ES", nl: "EBAY_NL", pl: "EBAY_PL" };
  return language && byLanguage[language] ? getRegion(byLanguage[language]) : null;
}

/** The locale to store alongside a chosen region: the browser's own when it is for that country, else the region's default. */
export function localeForRegion(region: Region, browserLocale: string | null | undefined): string {
  if (browserLocale && isLocale(browserLocale) && localeCountry(browserLocale) === region.id.slice(5)) return browserLocale;
  return region.locale;
}

// ------------------------------------------------------------------ formatting

/** "12.50" in the locale's own digits and separators; a currency adds its symbol. `null` currency formats a plain number. */
export function formatMoney(amount: number | null | undefined, currency: string | null | undefined, locale: string | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "";
  const loc = localeOrDefault(locale);
  try {
    return currency
      ? new Intl.NumberFormat(loc, { style: "currency", currency }).format(amount)
      : new Intl.NumberFormat(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)}${currency ? ` ${currency}` : ""}`;
  }
}

/** A short money figure for tight charts: 1.2K, 3.4M, in the locale. */
export function formatMoneyCompact(amount: number, currency: string | null | undefined, locale: string | null | undefined): string {
  const loc = localeOrDefault(locale);
  try {
    return new Intl.NumberFormat(loc, { style: currency ? "currency" : "decimal", ...(currency ? { currency } : {}), notation: "compact", maximumFractionDigits: 1 }).format(amount);
  } catch {
    return String(Math.round(amount));
  }
}

export function formatNumber(n: number, locale: string | null | undefined): string {
  try {
    return new Intl.NumberFormat(localeOrDefault(locale)).format(n);
  } catch {
    return String(n);
  }
}

/** The currency's symbol in a locale ("CA$", "$", "€"), or its code when the runtime has none. */
export function currencySymbol(currency: string, locale: string | null | undefined): string {
  try {
    const part = new Intl.NumberFormat(localeOrDefault(locale), { style: "currency", currency, currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}

/** "CAD ($)": the code plus the symbol, for labels on price inputs. */
export function currencyLabel(currency: string, locale: string | null | undefined): string {
  const sym = currencySymbol(currency, locale);
  return sym === currency ? currency : `${currency} (${sym})`;
}

/** A calendar date (`2026-03-01`) or a timestamp, in the viewer's locale. Calendar dates never shift with the time zone. */
export function formatDate(value: string | null | undefined, locale: string | null | undefined): string {
  if (!value) return "";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(localeOrDefault(locale), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
  } catch {
    return value;
  }
}

/** "Mar 2026" for a month bucket. */
export function formatMonth(value: string, locale: string | null | undefined, opts: { year?: boolean } = { year: true }): string {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(localeOrDefault(locale), { month: "short", ...(opts.year ? { year: "numeric" } : {}), timeZone: "UTC" }).format(d);
  } catch {
    return value;
  }
}
