import { Suspense } from "react";
import type { Metadata } from "next";
import { hasFullAccess, libraryHasGrantedMember } from "@/lib/access";
import { recommendConfigured } from "@/lib/ai/recommend";
import { personalReady, personalSignal, sharedSignal } from "@/lib/ai/recommend-prompt";
import { canEdit } from "@/lib/books/access";
import { getLibraryContext, type LibraryRole } from "@/lib/library";
import { capMessage, timeAgo } from "@/lib/discover/caps";
import { inLibrary } from "@/lib/discover/match";
import { latestSets, loadMembers, loadUserRows, refreshUsage } from "@/lib/discover/recs";
import { loadSeriesOverview, type SeriesOverview } from "@/lib/discover/series-data";
import type { StoredPick } from "@/lib/discover/types";
import { hardcoverConfigured } from "@/lib/metadata/hardcover";
import { createClient } from "@/lib/supabase/server";
import { Locked } from "@/components/locked";
import { PickCardsSkeleton } from "@/components/skeletons";
import { EmptyState, PageHeader, SpineRow } from "@/components/shelf";
import { getDeclined, getLibraryBooks, getLibraryIndex } from "./loaders";
import { loadActiveSeriesJob } from "@/lib/jobs/queue/queries";
import { FindSeriesButton, SeriesJobStatus, SeriesSection } from "./series-section";
import { DiscoverTabs } from "./discover-tabs";
import { panelId, parseTab, tabId, type DiscoverTabId } from "./tab-ids";
import { RecSection, type CapView, type ClientPick, type RecState } from "./rec-section";

export const metadata: Metadata = { title: "Discover" };
/** Generating picks (and the series lookups behind the buttons) can take a couple of minutes. */
export const maxDuration = 300;

function SectionPanel({ tab, index, title, lede, children }: { tab: DiscoverTabId; index: number; title: string; lede: string; children: React.ReactNode }) {
  return (
    <section role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} className="rise panel flex flex-col gap-6 p-5 md:p-8" style={{ ["--i" as string]: index }}>
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

const toClient = (p: StoredPick, scope: "personal" | "shared"): ClientPick => ({
  key: p.key,
  // Sets stored before groups existed were all based on ratings.
  category: scope === "personal" ? (p.category ?? "ratings") : undefined,
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
  canSync,
  activeJob,
}: {
  libraryId: string;
  overview: SeriesOverview | null;
  failed: boolean;
  canEditLibrary: boolean;
  syncConfigured: boolean;
  /** Whether this person may start a series sync (full access). Without it they still see what others have synced. */
  canSync: boolean;
  /** A series lookup that is queued or running for this library, which replaces the Find my series button. */
  activeJob: { id: string; status: "queued" | "running"; processed: number; total: number; canCancel: boolean } | null;
}) {
  if (failed || !overview) {
    return <p className="text-base text-muted-foreground">The series list could not be loaded. Refresh the page to try again.</p>;
  }
  const { gaps, unsynced, withSeriesText, completeCount } = overview;
  const withGaps = gaps.filter((g) => g.missing.length > 0 || g.pending);

  const syncNote = !canSync ? (
    <Locked variant="inline" />
  ) : !syncConfigured ? (
    <p className="text-sm text-muted-foreground">Series lookup is not set up on this server yet, so new series cannot be fetched and existing ones cannot be refreshed.</p>
  ) : null;

  if (withSeriesText === 0 && gaps.length === 0 && unsynced === 0) {
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
      {activeJob && <SeriesJobStatus job={activeJob} canCancel={activeJob.canCancel} />}
      {unsynced > 0 && (
        <div className="flex flex-col gap-3 rounded-[10px] border border-dashed border-input p-4">
          <p className="text-base">
            {unsynced} book{unsynced === 1 ? "" : "s"} {unsynced === 1 ? "hasn't" : "haven't"} been checked for a series yet.
          </p>
          {activeJob ? null : canSync && syncConfigured ? <FindSeriesButton libraryId={libraryId} /> : syncNote}
        </div>
      )}
      {withGaps.length > 0 && <SeriesSection libraryId={libraryId} gaps={withGaps} canEdit={canEditLibrary} canRefresh={syncConfigured && canSync} />}
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

/** Placeholder for a section's body while its data loads; the panel's heading and lede are already on screen. */
function BodySkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading</span>
      <PickCardsSkeleton count={cards} />
    </div>
  );
}

async function SeriesPanel({ libraryId, userId, role }: { libraryId: string; userId: string; role: LibraryRole }) {
  const supabase = await createClient();
  const syncConfigured = hardcoverConfigured() && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  // Claude and Hardcover are for people with full access. Without it, the series that a granted member of the library
  // has already synced are still shown; everything that would call out is locked.
  const [fullAccess, granted] = await Promise.all([hasFullAccess(supabase, userId), libraryHasGrantedMember(libraryId)]);
  if (!fullAccess && !granted) return <Locked />;

  let overview: SeriesOverview | null = null;
  let failed = false;
  try {
    overview = await loadSeriesOverview(supabase, libraryId, await getLibraryBooks(libraryId));
  } catch {
    failed = true;
  }
  const job = await loadActiveSeriesJob(supabase, libraryId);
  const activeJob = job
    ? { id: job.id, status: (job.status === "queued" ? "queued" : "running") as "queued" | "running", processed: job.processed, total: job.total, canCancel: role === "owner" || job.userId === userId }
    : null;
  return <SeriesBody libraryId={libraryId} overview={overview} failed={failed} canEditLibrary={canEdit(role)} syncConfigured={syncConfigured} canSync={fullAccess} activeJob={activeJob} />;
}

/** The latest set of a scope, minus what is declined or already on the shelves, and today's refresh allowance. */
async function sectionData(scope: "personal" | "shared", libraryId: string, userId: string, now: number) {
  const supabase = await createClient();
  const [sets, usage, declined, libraryIndex] = await Promise.all([
    latestSets(supabase, scope, { libraryId, userId }),
    refreshUsage(supabase, scope, { libraryId, userId }, now),
    getDeclined(userId),
    getLibraryIndex(libraryId),
  ]);
  const set = sets.latest;
  const picks = (set?.items ?? [])
    .filter((p) => !declined.has(p.key))
    .filter((p) => !inLibrary(libraryIndex, { title: p.title, authors: p.authors, isbn13s: [p.book?.isbn13], hardcoverId: p.book?.ids?.hardcover ?? null }))
    .map((p) => toClient(p, scope));
  const cap: CapView = { used: usage.used, cap: usage.cap, remaining: usage.remaining, reached: usage.reached, message: usage.reached ? capMessage(scope, usage.nextAt, now) : null };
  return { picks, cap, updatedAt: set?.generatedAt ?? null, updatedLabel: set ? timeAgo(set.generatedAt, now) : null };
}

async function PersonalSection({ libraryId, userId, role }: { libraryId: string; userId: string; role: LibraryRole }) {
  const supabase = await createClient();
  if (!(await hasFullAccess(supabase, userId))) return <Locked />;
  const recsOn = recommendConfigured();
  const [data, rows, books] = await Promise.all([sectionData("personal", libraryId, userId, requestTime()), loadUserRows(supabase, libraryId, [userId]), getLibraryBooks(libraryId)]);

  // The library alone is enough to start from; ratings only unlock the "Because you rated" group.
  const ready = personalReady(books.length);
  const mine = personalSignal(rows, userId);
  const state: RecState = !recsOn
    ? { kind: "unavailable" }
    : !ready.enough
      ? { kind: "needs-books", have: ready.books, needed: ready.needed }
      : { kind: "ready", ratingsLock: mine.enough ? null : { rated: mine.rated, needed: mine.needed } };
  return <RecSection libraryId={libraryId} scope="personal" state={state} {...data} canEdit={canEdit(role)} />;
}

async function SharedSection({ libraryId, userId, role }: { libraryId: string; userId: string; role: LibraryRole }) {
  const supabase = await createClient();
  const recsOn = recommendConfigured();
  const [fullAccess, data, members] = await Promise.all([hasFullAccess(supabase, userId), sectionData("shared", libraryId, userId, requestTime()), loadMembers(supabase, libraryId)]);
  if (!fullAccess && data.picks.length === 0) return <Locked />;

  // The shared signal needs every member's ratings, which the member policy on user_books allows.
  let state: RecState;
  if (!recsOn) state = { kind: "unavailable" };
  else if (members.length < 2) state = { kind: "needs-members" };
  else {
    const all = await loadUserRows(supabase, libraryId, members.map((m) => m.id));
    const sig = sharedSignal(all, members.map((m) => m.id));
    state = sig.enough ? { kind: "ready", ratingsLock: null } : { kind: "needs-both", needed: sig.needed };
  }
  return <RecSection libraryId={libraryId} scope="shared" state={state} {...data} canEdit={canEdit(role)} readOnly={!fullAccess} />;
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ user, current }, search] = await Promise.all([getLibraryContext(), searchParams]);
  if (!current) return null; // The layout shows the create-library prompt.
  const tab = parseTab(search.tab);

  // The page shell renders at once. Only the open tab's section is rendered, so the other tabs' queries do not run.
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader eyebrow="What to read next" title="Discover" lede="Fill the gaps in the series you own, then find something new." />
      <DiscoverTabs active={tab} />

      {tab === "series" && (
        <SectionPanel tab="series" index={1} title="Complete your series" lede="Volumes missing from the series on your shelves. Unreleased books and box sets are left out.">
          <Suspense fallback={<BodySkeleton cards={1} />}>
            <SeriesPanel libraryId={current.id} userId={user.id} role={current.role} />
          </Suspense>
        </SectionPanel>
      )}

      {tab === "you" && (
        <SectionPanel tab="you" index={2} title="For you" lede="Picks from what your shelves hold and what you have rated, grouped by how they were chosen, each with the reason it was picked.">
          <Suspense fallback={<BodySkeleton />}>
            <PersonalSection libraryId={current.id} userId={user.id} role={current.role} />
          </Suspense>
        </SectionPanel>
      )}

      {tab === "both" && (
        <SectionPanel tab="both" index={3} title="For both of you" lede="Books the two of you would likely both enjoy, based on your ratings. Your notes are never used here.">
          <Suspense fallback={<BodySkeleton />}>
            <SharedSection libraryId={current.id} userId={user.id} role={current.role} />
          </Suspense>
        </SectionPanel>
      )}
    </div>
  );
}
