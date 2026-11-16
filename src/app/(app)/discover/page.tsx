import type { Metadata } from "next";
import { recommendConfigured } from "@/lib/ai/recommend";
import { personalSignal, sharedSignal } from "@/lib/ai/recommend-prompt";
import { canEdit } from "@/lib/books/access";
import { getLibraryContext } from "@/lib/library";
import { capMessage, timeAgo } from "@/lib/discover/caps";
import { buildLibraryIndex, inLibrary } from "@/lib/discover/match";
import { latestSets, loadFeedback, loadLibraryBooks, loadMembers, loadUserRows, refreshUsage, type SetRow } from "@/lib/discover/recs";
import { loadSeriesOverview, type SeriesOverview } from "@/lib/discover/series-data";
import type { StoredPick } from "@/lib/discover/types";
import { hardcoverConfigured } from "@/lib/metadata/hardcover";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, PageHeader, SpineRow } from "@/components/shelf";
import { FindSeriesButton, SeriesSection } from "./series-section";
import { RecSection, type CapView, type ClientPick, type RecState } from "./rec-section";

export const metadata: Metadata = { title: "Discover" };
/** Generating picks (and the series lookups behind the buttons) can take a couple of minutes. */
export const maxDuration = 300;

function SectionPanel({ index, title, lede, children }: { index: number; title: string; lede: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`discover-${index}`} className="rise panel flex flex-col gap-6 p-5 md:p-8" style={{ ["--i" as string]: index }}>
      <div className="flex max-w-prose flex-col gap-2">
        <h2 id={`discover-${index}`} className="text-2xl leading-tight font-medium">
          {title}
        </h2>
        <p className="text-base text-muted-foreground">{lede}</p>
      </div>
      {children}
    </section>
  );
}

/** The time of this request (a server page runs once per request, so this is not re-evaluated on re-render). */
function requestTime() {
  return Date.now();
}

const toClient = (p: StoredPick): ClientPick => ({
  key: p.key,
  title: p.title,
  authors: p.authors,
  reason: p.reason,
  fit: p.fit ?? [],
  series: p.series ? `${p.series.name}${p.series.position !== null ? ` #${p.series.position}` : ""}` : null,
  coverUrl: p.book?.covers?.[0]?.url ?? null,
  year: p.book?.publishedDate?.slice(0, 4) ?? null,
});

function SpinesArt() {
  return (
    <SpineRow
      gap={2}
      spines={[
        { w: 24, h: 112, tone: 2 },
        { w: 24, h: 112, tone: 2 },
        { w: 24, h: 112, tone: 2 },
        { w: 24, h: 112, tone: 2 },
      ]}
    />
  );
}

function SeriesBody({
  libraryId,
  overview,
  failed,
  canEditLibrary,
  syncConfigured,
}: {
  libraryId: string;
  overview: SeriesOverview | null;
  failed: boolean;
  canEditLibrary: boolean;
  syncConfigured: boolean;
}) {
  if (failed || !overview) {
    return <p className="text-base text-muted-foreground">The series list could not be loaded. Refresh the page to try again.</p>;
  }
  const { gaps, unsynced, withSeriesText, completeCount } = overview;
  const withGaps = gaps.filter((g) => g.missing.length > 0 || g.pending);

  const syncNote = !syncConfigured ? (
    <p className="text-sm text-muted-foreground">Series lookup is not set up on this server yet, so new series cannot be fetched and existing ones cannot be refreshed.</p>
  ) : null;

  if (withSeriesText === 0 && gaps.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          title="No series on your shelves yet"
          body="When a book you add belongs to a series, the volumes you are missing show up here, ready to add to your wishlist."
          art={<SpinesArt />}
        />
        {syncNote}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {unsynced > 0 && (
        <div className="flex flex-col gap-3 rounded-[10px] border border-dashed border-input p-4">
          <p className="text-base">
            {unsynced} book{unsynced === 1 ? "" : "s"} {unsynced === 1 ? "belongs" : "belong"} to a series that has not been looked up yet.
          </p>
          {syncConfigured ? <FindSeriesButton libraryId={libraryId} /> : syncNote}
        </div>
      )}
      {withGaps.length > 0 && <SeriesSection libraryId={libraryId} gaps={withGaps} canEdit={canEditLibrary} canRefresh={syncConfigured} />}
      {withGaps.length === 0 && unsynced === 0 && (
        <p className="text-base text-muted-foreground">
          {completeCount > 0 ? `Nothing missing. ${completeCount === 1 ? "Your series is" : `All ${completeCount} of your series are`} complete as far as released books go.` : "Nothing missing right now."}
        </p>
      )}
      {withGaps.length > 0 && completeCount > 0 && (
        <p className="text-sm text-muted-foreground">
          {completeCount} other {completeCount === 1 ? "series is" : "series are"} complete.
        </p>
      )}
      {unsynced === 0 && syncNote}
    </div>
  );
}

export default async function Page() {
  const { user, current } = await getLibraryContext();
  if (!current) return null; // The layout shows the create-library prompt.

  const supabase = await createClient();
  const now = requestTime();
  const editor = canEdit(current.role);
  const syncConfigured = hardcoverConfigured() && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const recsOn = recommendConfigured();

  let overview: SeriesOverview | null = null;
  let seriesFailed = false;
  try {
    overview = await loadSeriesOverview(supabase, current.id);
  } catch {
    seriesFailed = true;
  }

  // Everything the two recommendation sections need, read through the signed-in user's own client.
  const [books, members, rows, feedback] = await Promise.all([
    loadLibraryBooks(supabase, current.id),
    loadMembers(supabase, current.id),
    loadUserRows(supabase, current.id, [user.id]),
    loadFeedback(supabase, [user.id]),
  ]);
  const libraryIndex = buildLibraryIndex(books);
  const declined = new Set(feedback.map((f) => f.workKey)); // not interested, already read or wishlisted: no longer shown

  async function sectionData(scope: "personal" | "shared") {
    const [sets, usage] = await Promise.all([
      latestSets(supabase, scope, { libraryId: current!.id, userId: user.id }),
      refreshUsage(supabase, scope, { libraryId: current!.id, userId: user.id }, now),
    ]);
    const set: SetRow | null = sets.latest;
    const picks = (set?.items ?? [])
      .filter((p) => !declined.has(p.key))
      .filter((p) => !inLibrary(libraryIndex, { title: p.title, authors: p.authors, isbn13s: [p.book?.isbn13], hardcoverId: p.book?.ids?.hardcover ?? null }))
      .map(toClient);
    const cap: CapView = { used: usage.used, cap: usage.cap, remaining: usage.remaining, reached: usage.reached, message: usage.reached ? capMessage(scope, usage.nextAt, now) : null };
    return {
      picks,
      cap,
      updatedAt: set?.generatedAt ?? null,
      updatedLabel: set ? timeAgo(set.generatedAt, now) : null,
    };
  }

  const personal = await sectionData("personal");
  const shared = await sectionData("shared");

  const mine = personalSignal(rows, user.id);
  const personalState: RecState = !recsOn ? { kind: "unavailable" } : mine.enough ? { kind: "ready" } : { kind: "needs-ratings", rated: mine.rated, needed: mine.needed };

  // The shared signal needs every member's ratings, which the member policy on user_books allows.
  let sharedState: RecState;
  if (!recsOn) sharedState = { kind: "unavailable" };
  else if (members.length < 2) sharedState = { kind: "needs-members" };
  else {
    const all = await loadUserRows(supabase, current.id, members.map((m) => m.id));
    const sig = sharedSignal(all, members.map((m) => m.id));
    sharedState = sig.enough ? { kind: "ready" } : { kind: "needs-both", needed: sig.needed };
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader eyebrow="What to read next" title="Discover" lede="Fill the gaps in the series you own, then find something new." />

      <SectionPanel index={1} title="Complete your series" lede="Volumes missing from the series on your shelves. Unreleased books and box sets are left out.">
        <SeriesBody libraryId={current.id} overview={overview} failed={seriesFailed} canEditLibrary={editor} syncConfigured={syncConfigured} />
      </SectionPanel>

      <SectionPanel index={2} title="For you" lede="Picks based on what you have rated, finished and written about, each with the reason it was chosen.">
        <RecSection libraryId={current.id} scope="personal" state={personalState} picks={personal.picks} updatedAt={personal.updatedAt} updatedLabel={personal.updatedLabel} cap={personal.cap} canEdit={editor} />
      </SectionPanel>

      <SectionPanel index={3} title="For both of you" lede="Books the two of you would likely both enjoy, based on your ratings. Your notes are never used here.">
        <RecSection libraryId={current.id} scope="shared" state={sharedState} picks={shared.picks} updatedAt={shared.updatedAt} updatedLabel={shared.updatedLabel} cap={shared.cap} canEdit={editor} />
      </SectionPanel>
    </div>
  );
}
