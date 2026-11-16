import { describe, expect, it } from "vitest";
import {
  REGIONS,
  currencyFor,
  currencyLabel,
  currencySymbol,
  formatDate,
  formatMoney,
  formatMonth,
  getRegion,
  guessRegion,
  isLocale,
  isRegionId,
  localeForRegion,
} from "./regions";

describe("region table", () => {
  it("covers the 16 marketplaces eBay lists for the Buy APIs", () => {
    expect(REGIONS.map((r) => r.id).sort()).toEqual(
      ["EBAY_AT", "EBAY_AU", "EBAY_BE", "EBAY_CA", "EBAY_CH", "EBAY_DE", "EBAY_ES", "EBAY_FR", "EBAY_GB", "EBAY_HK", "EBAY_IE", "EBAY_IT", "EBAY_NL", "EBAY_PL", "EBAY_SG", "EBAY_US"],
    );
  });

  it("gives every entry a valid ISO currency, locale and domain, with unique ids", () => {
    expect(new Set(REGIONS.map((r) => r.id)).size).toBe(REGIONS.length);
    for (const r of REGIONS) {
      expect(r.currency).toMatch(/^[A-Z]{3}$/);
      expect(isLocale(r.locale)).toBe(true);
      expect(r.domain).toMatch(/^ebay\./);
      expect(() => new Intl.NumberFormat(r.locale, { style: "currency", currency: r.currency })).not.toThrow();
      expect(r.id).toMatch(/^EBAY_[A-Z]{2}$/);
    }
  });

  it("maps regions to currencies", () => {
    expect(currencyFor("EBAY_CA")).toBe("CAD");
    expect(currencyFor("EBAY_DE")).toBe("EUR");
    expect(currencyFor("EBAY_CH")).toBe("CHF");
    expect(currencyFor("EBAY_XX")).toBeNull();
    expect(currencyFor(null)).toBeNull();
  });

  it("recognises ids", () => {
    expect(isRegionId("EBAY_GB")).toBe(true);
    expect(isRegionId("EBAY_ZZ")).toBe(false);
    expect(isRegionId(42)).toBe(false);
    expect(getRegion("EBAY_AU")?.country).toBe("Australia");
  });
});

describe("guessRegion", () => {
  it("trusts a locale that names one of our countries", () => {
    expect(guessRegion("en-CA", "America/New_York")?.id).toBe("EBAY_CA");
    expect(guessRegion("de-AT", "Europe/Berlin")?.id).toBe("EBAY_AT");
    expect(guessRegion("en-GB", null)?.id).toBe("EBAY_GB");
    expect(guessRegion("fr-FR", "Europe/Paris")?.id).toBe("EBAY_FR");
  });

  it("lets the time zone override a default en-US locale", () => {
    expect(guessRegion("en-US", "America/Toronto")?.id).toBe("EBAY_CA");
    expect(guessRegion("en-US", "Australia/Sydney")?.id).toBe("EBAY_AU");
    expect(guessRegion("en-US", "Europe/Dublin")?.id).toBe("EBAY_IE");
    expect(guessRegion("en-US", "America/Chicago")?.id).toBe("EBAY_US");
  });

  it("uses the time zone when the locale has no country", () => {
    expect(guessRegion("en", "Europe/London")?.id).toBe("EBAY_GB");
    expect(guessRegion("fr", "America/Montreal")?.id).toBe("EBAY_CA");
  });

  it("falls back on the language, and returns null when there is nothing to go on", () => {
    expect(guessRegion("de", null)?.id).toBe("EBAY_DE");
    expect(guessRegion("en", null)?.id).toBe("EBAY_US");
    expect(guessRegion("ja-JP", "Asia/Tokyo")).toBeNull();
    expect(guessRegion(null, null)).toBeNull();
    expect(guessRegion("not a locale", "Nowhere/Land")).toBeNull();
  });

  it("keeps the browser's own locale for a region only when it is for that country", () => {
    const ca = getRegion("EBAY_CA")!;
    expect(localeForRegion(ca, "fr-CA")).toBe("fr-CA");
    expect(localeForRegion(ca, "en-US")).toBe("en-CA");
    expect(localeForRegion(ca, null)).toBe("en-CA");
  });
});

describe("formatting", () => {
  it("formats money per locale and currency", () => {
    expect(formatMoney(1234.5, "CAD", "en-CA")).toBe("$1,234.50");
    expect(formatMoney(1234.5, "USD", "en-CA")).toBe("US$1,234.50");
    expect(formatMoney(1234.5, "EUR", "de-DE")).toMatch(/^1\.234,50\s€$/);
    expect(formatMoney(12, "GBP", "en-GB")).toBe("£12.00");
    expect(formatMoney(5, null, "en-US")).toBe("5.00");
    expect(formatMoney(null, "USD", "en-US")).toBe("");
  });

  it("falls back to en-US for an unknown locale", () => {
    expect(formatMoney(3, "USD", "zz-not-valid-@")).toBe("$3.00");
    expect(formatMoney(3, "USD", null)).toBe("$3.00");
  });

  it("labels currencies with code and symbol", () => {
    expect(currencySymbol("EUR", "de-DE")).toBe("€");
    expect(currencyLabel("CAD", "en-CA")).toBe("CAD ($)");
    expect(currencyLabel("USD", "en-CA")).toMatch(/^USD \(/);
  });

  it("formats calendar dates without time zone drift", () => {
    expect(formatDate("2026-03-01", "en-GB")).toBe("1 Mar 2026");
    expect(formatDate("2026-03-01", "en-US")).toBe("Mar 1, 2026");
    expect(formatDate("2026-03-01T23:30:00Z", "en-GB")).toBe("1 Mar 2026");
    expect(formatDate("", "en-GB")).toBe("");
    expect(formatDate("garbage", "en-GB")).toBe("garbage");
  });

  it("formats month buckets", () => {
    expect(formatMonth("2026-03-01", "en-US")).toBe("Mar 2026");
    expect(formatMonth("2026-03-01", "en-US", { year: false })).toBe("Mar");
  });
});
