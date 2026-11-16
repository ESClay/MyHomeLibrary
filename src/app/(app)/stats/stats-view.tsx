"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BarList, type BarRow } from "@/components/charts/bar-list";
import { ColumnChart } from "@/components/charts/column-chart";
import { DataTable } from "@/components/charts/data-table";
import { Cover } from "@/components/cover";
import { useLocale } from "@/components/locale-provider";
import { NativeSelect } from "@/components/ui/native-select";
import { FORMAT_LABEL, type Format } from "@/lib/books/constants";
import { formatMoney, formatMonth, formatNumber } from "@/lib/regions";
import {
  addedByMonth,
  ownershipTotals,
  ratingDistribution,
  readingByMonth,
  readingByYear,
  readingTotals,
  seriesFor,
  unreadBySeries,
  valueSummary,
  whoOptions,
  yearsWithReads,
  type Metric,
  type Person,
  type PersonSeries,
  type Who,
} from "@/lib/stats/aggregate";
import type { StatsData } from "@/lib/stats/data";
import { cn } from "@/lib/utils";

/** Colour follows the entity: you are cloth green, your partner is the terracotta spine, the library itself is brass. */
const COLOR = { me: "var(--cloth)", partner: "var(--spine-5)", library: "var(--gilt)" } as const;

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-input bg-card p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-10 min-w-16 cursor-pointer rounded-md px-3 text-sm font-medium transition-colors duration-[var(--dur-fast)]",
            value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Section({ id, title, aside, children }: { id: string; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="rise panel flex flex-col gap-6 p-5 md:p-7" style={{ ["--i" as string]: 1 }}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={id} className="text-2xl leading-tight font-medium">
          {title}
        </h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="font-display text-lg leading-snug font-medium">{title}</h3>
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("font-display text-2xl leading-tight font-medium tabular-nums sm:text-3xl", tone === "bad" && "text-destructive")}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function StatsView({ stats, people, currency, nowIso }: { stats: StatsData; people: Person[]; currency: string | null; nowIso: string }) {
  const locale = useLocale();
  const [who, setWho] = useState<Who>("both");
  const [metric, setMetric] = useState<Metric>("books");
  const options = whoOptions(people);
  // With one member there is nothing to choose, and every value shows that one person.
  const effective: Who = options.length === 1 ? "me" : who;
  const series = useMemo(() => seriesFor(effective, people), [effective, people]);
  const colorOf = (s: PersonSeries) => COLOR[s.key];
  const n = (x: number) => formatNumber(x, locale);

  // ---- reading
  const totals = readingTotals(stats.reading, series);
  const years = yearsWithReads(stats.reading, series);
  const [yearPick, setYearPick] = useState<number | null>(null);
  const year = yearPick !== null && years.includes(yearPick) ? yearPick : (years[0] ?? new Date(nowIso).getUTCFullYear());
  const byYear = readingByYear(stats.reading, series, metric);
  const byMonth = readingByMonth(stats.reading, series, year, metric);
  const monthNames = Array.from({ length: 12 }, (_, i) => formatMonth(`2026-${String(i + 1).padStart(2, "0")}-01`, locale, { year: false }));
  const unit = metric === "books" ? "books" : "pages";

  // ---- value
  const value = stats.value;
  const sum = value ? valueSummary(value.total) : null;
  const money = (x: number) => formatMoney(x, currency, locale);

  // ---- taste
  const dist = ratingDistribution(stats.ratings, series);
  const halfLabels = Array.from({ length: 10 }, (_, i) => String((i + 1) / 2));
  const asBars = (rows: { label: string; books: number }[]): BarRow[] => rows.map((r) => ({ key: r.label, label: r.label, value: r.books, display: n(r.books) }));
  const formatBars: BarRow[] = stats.formats.map((f) => ({ key: f.format, label: FORMAT_LABEL[f.format as Format] ?? f.format, value: f.copies, display: n(f.copies) }));

  // ---- growth
  const growth = addedByMonth(stats.added, new Date(nowIso), 12);
  const own = ownershipTotals(stats.added);
  const unread = unreadBySeries(stats.unread, series);
  const monthLabel = (m: string) => formatMonth(m, locale);

  return (
    <div className="flex flex-col gap-6">
      {options.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-sm font-semibold" id="who-label">
            Show
          </p>
          <Segmented label="Whose reading to show" value={effective} options={options.map((o) => ({ value: o.who, label: o.label }))} onChange={setWho} />
          <p className="text-sm text-muted-foreground">Applies to reading, ratings and unread books.</p>
        </div>
      )}

      {/* ------------------------------------------------------------ reading */}
      <Section
        id="reading"
        title="Reading"
        aside={<Segmented label="Count" value={metric} options={[{ value: "books", label: "Books" }, { value: "pages", label: "Pages" }]} onChange={setMetric} />}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Books finished" value={n(totals.books)} sub="all time" />
          <Stat label="Pages read" value={n(totals.pages)} sub={totals.books > 0 ? `${n(Math.round(totals.pages / totals.books))} a book on average` : undefined} />
          <Stat label={`Read in ${year}`} value={n(byMonth.flat().reduce((a, b) => a + b, 0))} sub={unit} />
        </div>

        {byYear.years.length === 0 ? (
          <p className="text-base text-muted-foreground">No finished reads yet. Log a read on a book&rsquo;s page and it counts here.</p>
        ) : (
          <div className="grid gap-8 lg:grid-cols-2">
            <Block title={`${metric === "books" ? "Books" : "Pages"} per year`}>
              <ColumnChart
                ariaLabel={`${unit} finished per year`}
                categories={byYear.years.map(String)}
                series={series.map((s, i) => ({ key: s.key, label: s.label, color: colorOf(s), values: byYear.values[i] }))}
                format={n}
              />
              <DataTable caption={`${unit} finished per year`} columns={["Year", ...series.map((s) => s.label)]} rows={byYear.years.map((y, i) => [String(y), ...series.map((_, si) => n(byYear.values[si][i]))])} />
            </Block>
            <Block title={`${metric === "books" ? "Books" : "Pages"} per month`}>
              <label className="flex w-fit items-center gap-2 text-sm">
                <span className="text-muted-foreground">Year</span>
                <NativeSelect aria-label="Year" value={year} onChange={(e) => setYearPick(Number(e.target.value))} className="w-28">
                  {(years.length ? years : [year]).map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <ColumnChart
                ariaLabel={`${unit} finished per month in ${year}`}
                categories={monthNames}
                series={series.map((s, i) => ({ key: s.key, label: s.label, color: colorOf(s), values: byMonth[i] }))}
                format={n}
              />
              <DataTable caption={`${unit} finished per month in ${year}`} columns={["Month", ...series.map((s) => s.label)]} rows={monthNames.map((m, i) => [m, ...series.map((_, si) => n(byMonth[si][i]))])} />
            </Block>
          </div>
        )}
      </Section>

      {/* -------------------------------------------------------------- value */}
      <Section id="value" title="Library value">
        {!value || !sum ? (
          <p className="text-base text-muted-foreground">Prices are off for this library. Once its owner chooses a price region in Settings, the shelves&rsquo; worth shows up here.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Est. market value" value={money(value.total.estValue)} sub="asking prices on eBay" />
              <Stat label="Paid for those copies" value={money(value.total.paidPriced)} sub={value.total.paid !== value.total.paidPriced ? `${money(value.total.paid)} across every copy` : undefined} />
              <Stat
                label="Difference"
                value={sum.diff === null ? "None yet" : `${sum.diff >= 0 ? "+" : "−"}${money(Math.abs(sum.diff))}`}
                sub={sum.diffPct === null ? undefined : `${sum.diffPct >= 0 ? "Up" : "Down"} ${Math.abs(sum.diffPct)}% on what you paid`}
                tone={sum.diff !== null && sum.diff < 0 ? "bad" : undefined}
              />
              <Stat label="Copies priced" value={`${n(value.total.priced)} of ${n(value.total.copies)}`} sub={`${Math.round(sum.coverage * 100)}% of physical copies`} />
            </div>
            <p className="text-sm text-muted-foreground">
              Totals use only prices in {currency}, and only hardcovers and paperbacks you own.{" "}
              {value.total.unpriced > 0 ? `${n(value.total.unpriced)} ${value.total.unpriced === 1 ? "copy has" : "copies have"} no price yet. ` : ""}
              {value.total.otherCurrency > 0 ? `${n(value.total.otherCurrency)} ${value.total.otherCurrency === 1 ? "is" : "are"} priced in another currency and left out until checked again.` : ""}
            </p>

            <div className="grid gap-8 lg:grid-cols-2">
              <Block title="By shelf" note="Estimated value of the copies on each shelf. A book on two shelves counts on both.">
                <BarList
                  ariaLabel="Estimated value by shelf"
                  empty="Put priced books on shelves to see them here."
                  rows={value.byShelf
                    .filter((s) => s.estValue > 0)
                    .map((s) => ({ key: s.shelfId, label: s.name, value: s.estValue, display: money(s.estValue), sub: `paid ${money(s.paid)} · ${n(s.priced)} of ${n(s.copies)} priced`, color: COLOR.library }))}
                />
                <DataTable
                  caption="Value by shelf"
                  columns={["Shelf", "Est. market", "Paid", "Priced"]}
                  rows={value.byShelf.map((s) => [s.name, money(s.estValue), money(s.paid), `${n(s.priced)} of ${n(s.copies)}`])}
                />
              </Block>

              <Block title="Most valuable copies" note="The top ten by estimated market value.">
                {value.top.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No priced copies yet. Use Check price on a book&rsquo;s page.</p>
                ) : (
                  <ol className="flex flex-col divide-y divide-border">
                    {value.top.map((t, i) => (
                      <li key={t.copyId}>
                        <Link href={`/books/${t.bookId}`} className="flex min-h-14 items-center gap-3 py-2 transition-colors hover:bg-accent/50">
                          <span aria-hidden className="w-5 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
                            {i + 1}
                          </span>
                          <Cover url={t.coverUrl} title={t.title} className="w-9 shrink-0" />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-[0.9375rem] font-medium">{t.title}</span>
                            <span className="truncate text-xs text-muted-foreground">
                              {t.authors[0] ?? "Unknown author"} · {FORMAT_LABEL[t.format as Format] ?? t.format}
                            </span>
                          </span>
                          <span className="flex shrink-0 flex-col items-end">
                            <span className="text-[0.9375rem] font-semibold tabular-nums">{money(t.price)}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">{t.approximate ? "approx." : ""}{t.approximate && t.paid !== null ? " · " : ""}{t.paid !== null ? `paid ${money(t.paid)}` : ""}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                )}
              </Block>
            </div>
          </>
        )}
      </Section>

      {/* -------------------------------------------------------------- taste */}
      <Section id="taste" title="Taste">
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          <Block title="Top authors" note="Books in the library">
            <BarList ariaLabel="Top authors" rows={asBars(stats.topAuthors).map((r) => ({ ...r, color: COLOR.library }))} />
            <DataTable caption="Top authors" columns={["Author", "Books"]} rows={stats.topAuthors.map((r) => [r.label, n(r.books)])} />
          </Block>
          <Block title="Top genres" note="Books in the library">
            <BarList ariaLabel="Top genres" rows={asBars(stats.topGenres).map((r) => ({ ...r, color: COLOR.library }))} empty="No genres recorded yet." />
            <DataTable caption="Top genres" columns={["Genre", "Books"]} rows={stats.topGenres.map((r) => [r.label, n(r.books)])} />
          </Block>
          <Block title="Top series" note="Books in the library">
            <BarList ariaLabel="Top series" rows={asBars(stats.topSeries).map((r) => ({ ...r, color: COLOR.library }))} empty="No series recorded yet." />
            <DataTable caption="Top series" columns={["Series", "Books"]} rows={stats.topSeries.map((r) => [r.label, n(r.books)])} />
          </Block>
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          <Block title="Ratings" note="How many books got each star rating">
            {dist.every((d) => d.every((v) => v === 0)) ? (
              <p className="text-sm text-muted-foreground">No ratings yet.</p>
            ) : (
              <>
                <ColumnChart
                  ariaLabel="Number of books at each star rating"
                  categories={halfLabels.map((l) => `${l} stars`)}
                  tickLabels={halfLabels}
                  series={series.map((s, i) => ({ key: s.key, label: s.label, color: colorOf(s), values: dist[i] }))}
                  format={n}
                />
                <DataTable caption="Books per star rating" columns={["Stars", ...series.map((s) => s.label)]} rows={halfLabels.map((l, i) => [l, ...series.map((_, si) => n(dist[si][i]))])} />
              </>
            )}
          </Block>
          <Block title="Formats" note="Copies you own, by format">
            <BarList ariaLabel="Copies by format" rows={formatBars.map((r) => ({ ...r, color: COLOR.library }))} empty="No copies yet." />
            <DataTable caption="Copies by format" columns={["Format", "Copies"]} rows={stats.formats.map((f) => [FORMAT_LABEL[f.format as Format] ?? f.format, n(f.copies)])} />
          </Block>
        </div>
      </Section>

      {/* ------------------------------------------------------------- growth */}
      <Section id="growth" title="Library growth">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Owned" value={n(own.owned)} />
          <Stat label="Wishlist" value={n(own.wishlist)} />
          <Stat label="Borrowed" value={n(own.borrowed)} />
        </div>
        <div className="grid gap-8 lg:grid-cols-2">
          <Block title="Books added per month" note={`Last 12 months${growth.before > 0 ? `, after ${n(growth.before)} added earlier` : ""}`}>
            <ColumnChart
              ariaLabel="Books added per month over the last 12 months"
              categories={growth.months.map(monthLabel)}
              tickLabels={growth.months.map((m) => formatMonth(m, locale, { year: false }))}
              series={[{ key: "added", label: "Books added", color: COLOR.library, values: growth.added }]}
              format={n}
            />
            <DataTable caption="Books added per month" columns={["Month", "Added"]} rows={growth.months.map((m, i) => [monthLabel(m), n(growth.added[i])])} />
          </Block>
          <Block title="Owned books not read yet" note="Of the books on your shelves">
            <BarList
              ariaLabel="Unread owned books"
              empty="Nothing owned yet."
              rows={unread.map((u) => ({
                key: u.key,
                label: u.label,
                value: u.unread,
                display: `${n(u.unread)} of ${n(u.owned)}`,
                sub: `${n(u.read)} read`,
                color: COLOR[u.key],
              }))}
            />
            <DataTable caption="Unread owned books" columns={["Reader", "Unread", "Read", "Owned"]} rows={unread.map((u) => [u.label, n(u.unread), n(u.read), n(u.owned)])} />
          </Block>
        </div>
      </Section>
    </div>
  );
}
