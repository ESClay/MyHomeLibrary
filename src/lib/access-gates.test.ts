/**
 * Every server entry point to a paid or quota-limited service answers "full access needed" without the entitlement,
 * and never reaches the service. Supabase and the providers are mocked; nothing here touches the network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/supabase-fake";

const state = vi.hoisted(() => ({
  granted: false,
  tables: {} as Record<string, Record<string, unknown>[]>,
  client: null as unknown,
}));
const USER = "2f6e1a52-8f33-4c1b-9b9e-0f5b3a7d1c11";
const LIB = "3a7d1c11-2f6e-4a52-8f33-9b9e0f5b3a7d";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  // One memo per test (no request scope in a unit test): reset by resetModules in load().
  cache: <T extends (...args: never[]) => unknown>(fn: T) => {
    let done = false;
    let value: unknown;
    return ((...args: never[]) => {
      if (!done) {
        value = fn(...args);
        done = true;
      }
      return value;
    }) as T;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
vi.mock("@/lib/library", () => ({ requireUser: async () => ({ id: USER }) }));

const spies = vi.hoisted(() => ({
  identifyBooks: vi.fn(),
  generateSet: vi.fn(),
  syncLibrarySeries: vi.fn(),
  enqueueJob: vi.fn(),
  runJobsTick: vi.fn(),
  getEbayClient: vi.fn(),
  createAdminClient: vi.fn(),
  search: vi.fn(),
  lookupByIsbn: vi.fn(),
  refreshFor: vi.fn(),
}));

vi.mock("@/lib/ai/identify", () => ({ identifyBooks: spies.identifyBooks, IdentifyError: class extends Error {} }));
vi.mock("@/lib/ai/recommend", () => ({ recommendConfigured: () => true, RecommendError: class extends Error {} }));
vi.mock("@/lib/discover/recs", () => ({
  generateSet: spies.generateSet,
  latestSets: vi.fn(),
  AccessDenied: class extends Error {},
  CapReached: class extends Error {},
  NotEnoughSignal: class extends Error {},
}));
vi.mock("@/lib/discover/series-sync", () => ({ syncLibrarySeries: spies.syncLibrarySeries }));
vi.mock("@/lib/jobs/queue/enqueue", () => ({ enqueueJob: spies.enqueueJob }));
vi.mock("@/lib/jobs/queue/tick", () => ({ runJobsTick: spies.runJobsTick }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: (fn: () => unknown) => void fn() }));
vi.mock("@/lib/metadata/hardcover", () => ({ hardcoverConfigured: () => true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: spies.createAdminClient }));
vi.mock("@/lib/pricing/ebay", () => ({
  EbayError: class extends Error {},
  ebayConfigured: () => true,
  getEbayClient: spies.getEbayClient,
}));
vi.mock("@/lib/metadata", async () => {
  const policy = await import("@/lib/metadata/policy");
  return { ...policy, search: spies.search, lookupByIsbn: spies.lookupByIsbn, refreshFor: spies.refreshFor, rateLimitedSince: () => false };
});
vi.mock("@/app/(app)/books/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/(app)/books/actions")>()),
  createBook: vi.fn(),
  addRead: vi.fn(),
  saveMyBook: vi.fn(),
}));
vi.mock("@/lib/scan/jobs", () => ({
  SCANS_BUCKET: "scans",
  dailyScanStatus: async () => ({ reached: false, remaining: 5, cap: 50 }),
}));

vi.mock("@/lib/books/access", () => ({
  authorizeBook: async () => ({ ok: true, user: { id: USER }, supabase: state.client, book: { id: "b", library_id: LIB, isbn13: null } }),
  canEdit: () => true,
  fail: (error: string) => ({ ok: false, error }),
  firstIssue: (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "bad",
  roleInLibrary: async () => "owner",
}));

function installClient() {
  const fake = fakeSupabase(state.tables, (fn) => (fn === "has_full_access" ? state.granted : false));
  state.client = Object.assign(fake, {
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: "none" } }) }) },
  });
  return fake;
}

async function load<T>(path: string): Promise<T> {
  vi.resetModules();
  return import(/* @vite-ignore */ path) as Promise<T>;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.granted = false;
  state.tables = {
    library_members: [{ library_id: LIB, user_id: USER, role: "owner" }],
    libraries: [{ id: LIB, price_region: "EBAY_CA" }],
  };
  installClient();
});

const DENIED = { ok: false, code: "full_access_required" };

describe("photo recognition", () => {
  const input = { libraryId: LIB, photoPath: `${LIB}/${USER}/7ebf5a55-6da2-4e96-8d77-3f9f7ebf5a55.jpg` };

  it("startScan refuses without full access and creates no job", async () => {
    const { startScan } = await load<typeof import("@/app/(app)/add/photo/actions")>("@/app/(app)/add/photo/actions");
    const res = await startScan(input);
    expect(res).toMatchObject(DENIED);
    expect(state.client && (state.client as ReturnType<typeof fakeSupabase>).writes).toEqual([]);
  });

  it("startScan goes on to create the job with full access", async () => {
    state.granted = true;
    const { startScan } = await load<typeof import("@/app/(app)/add/photo/actions")>("@/app/(app)/add/photo/actions");
    const res = await startScan(input);
    expect(res).toMatchObject({ ok: true });
    expect((state.client as ReturnType<typeof fakeSupabase>).writes.map((w) => w.table)).toEqual(["scan_jobs"]);
  });

  it("/api/scan/[id] answers 403 and never reads the job or calls Claude without full access", async () => {
    const { POST } = await load<typeof import("@/app/api/scan/[id]/route")>("@/app/api/scan/[id]/route");
    const res = await POST(new Request("http://x") as never, { params: Promise.resolve({ id: "4b8e2d22-3a7f-4b63-9a44-0c6c4b8e2d22" }) });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, code: "full_access_required", kind: "full_access_required" });
    expect(spies.identifyBooks).not.toHaveBeenCalled();
    expect((state.client as ReturnType<typeof fakeSupabase>).from).not.toHaveBeenCalled();
  });

  it("/api/scan/[id] gets past the check with full access", async () => {
    state.granted = true;
    const { POST } = await load<typeof import("@/app/api/scan/[id]/route")>("@/app/api/scan/[id]/route");
    const res = await POST(new Request("http://x") as never, { params: Promise.resolve({ id: "4b8e2d22-3a7f-4b63-9a44-0c6c4b8e2d22" }) });
    expect(res.status).toBe(404); // the job does not exist in this fake: it was looked up, so the gate let it through
  });
});

describe("recommendations", () => {
  it.each(["personal", "shared"] as const)("a manual %s refresh refuses without full access and never calls Claude", async (scope) => {
    const { refreshRecommendations } = await load<typeof import("@/app/(app)/discover/actions")>("@/app/(app)/discover/actions");
    expect(await refreshRecommendations({ libraryId: LIB, scope })).toMatchObject(DENIED);
    expect(spies.generateSet).not.toHaveBeenCalled();
  });

  it("a manual refresh runs with full access", async () => {
    state.granted = true;
    spies.generateSet.mockResolvedValue({ count: 3 });
    const { refreshRecommendations } = await load<typeof import("@/app/(app)/discover/actions")>("@/app/(app)/discover/actions");
    expect(await refreshRecommendations({ libraryId: LIB, scope: "shared" })).toEqual({ ok: true, count: 3 });
    expect(spies.generateSet).toHaveBeenCalledWith(expect.objectContaining({ scope: "shared", userId: USER, trigger: "manual" }));
  });
});

describe("series sync", () => {
  it("refreshSeries refuses without full access, before the service role or Hardcover", async () => {
    const { refreshSeries } = await load<typeof import("@/app/(app)/discover/actions")>("@/app/(app)/discover/actions");
    expect(await refreshSeries({ libraryId: LIB })).toMatchObject(DENIED);
    expect(spies.createAdminClient).not.toHaveBeenCalled();
    expect(spies.syncLibrarySeries).not.toHaveBeenCalled();
  });

  it("refreshSeries queues a background job with full access and kicks one tick, without syncing inline", async () => {
    state.granted = true;
    spies.createAdminClient.mockReturnValue({});
    spies.enqueueJob.mockResolvedValue({ job: { id: "j1" }, created: true });
    spies.runJobsTick.mockResolvedValue({ jobs: [] });
    const { refreshSeries } = await load<typeof import("@/app/(app)/discover/actions")>("@/app/(app)/discover/actions");
    expect(await refreshSeries({ libraryId: LIB })).toMatchObject({ ok: true });
    expect(spies.enqueueJob).toHaveBeenCalledWith(expect.anything(), { libraryId: LIB, userId: USER, kind: "series_lookup" });
    expect(spies.runJobsTick).toHaveBeenCalledTimes(1);
    expect(spies.syncLibrarySeries).not.toHaveBeenCalled();
  });

  it("refreshSeries returns the active job's message instead of queueing a second one", async () => {
    state.granted = true;
    spies.createAdminClient.mockReturnValue({});
    spies.enqueueJob.mockResolvedValue({ job: { id: "j1" }, created: false });
    spies.runJobsTick.mockResolvedValue({ jobs: [] });
    const { refreshSeries } = await load<typeof import("@/app/(app)/discover/actions")>("@/app/(app)/discover/actions");
    expect(await refreshSeries({ libraryId: LIB })).toEqual({ ok: true, message: "A series lookup is already running." });
  });
});

describe("eBay prices", () => {
  const COPY = "5c9f3e33-4b80-4c74-8b55-1d7d5c9f3e33";

  it("checkCopyPrice refuses without full access: no eBay client, no log row", async () => {
    const { checkCopyPrice } = await load<typeof import("@/app/(app)/books/price-actions")>("@/app/(app)/books/price-actions");
    expect(await checkCopyPrice(COPY)).toMatchObject(DENIED);
    expect(spies.getEbayClient).not.toHaveBeenCalled();
    expect((state.client as ReturnType<typeof fakeSupabase>).writes).toEqual([]);
    expect((state.client as ReturnType<typeof fakeSupabase>).from).not.toHaveBeenCalled();
  });
});

describe("online lookups use a provider policy", () => {
  const providersOf = (call: unknown[]) => (call[1] as { providers: string[] }).providers;

  it("/api/metadata searches Open Library only without full access", async () => {
    spies.search.mockResolvedValue([]);
    spies.lookupByIsbn.mockResolvedValue(null);
    const { GET } = await load<typeof import("@/app/api/metadata/route")>("@/app/api/metadata/route");
    await GET({ nextUrl: new URL("http://x/api/metadata?q=dune") } as never);
    await GET({ nextUrl: new URL("http://x/api/metadata?isbn=9780441172719") } as never);
    expect(providersOf(spies.search.mock.calls[0])).toEqual(["openlibrary"]);
    expect(providersOf(spies.lookupByIsbn.mock.calls[0])).toEqual(["openlibrary"]);
  });

  it("/api/metadata uses every provider with full access", async () => {
    state.granted = true;
    spies.search.mockResolvedValue([]);
    const { GET } = await load<typeof import("@/app/api/metadata/route")>("@/app/api/metadata/route");
    await GET({ nextUrl: new URL("http://x/api/metadata?q=dune") } as never);
    expect(providersOf(spies.search.mock.calls[0])).toEqual(["hardcover", "google", "openlibrary"]);
  });

  it("/api/suggest online results come from Open Library only without full access", async () => {
    spies.search.mockResolvedValue([]);
    const { GET } = await load<typeof import("@/app/api/suggest/route")>("@/app/api/suggest/route");
    await GET({ nextUrl: new URL("http://x/api/suggest?source=online&q=dune") } as never);
    expect(providersOf(spies.search.mock.calls[0])).toEqual(["openlibrary"]);
  });

  it("refreshMetadata looks the book up in Open Library only without full access", async () => {
    state.tables.books = [{ id: "6dae4f44-5c91-4d85-9c66-2e8e6dae4f44", title: "Dune", authors: ["Frank Herbert"], isbn13: "9780441172719" }];
    installClient();
    spies.refreshFor.mockResolvedValue(null);
    const { refreshMetadata } = await load<typeof import("@/app/(app)/books/actions")>("@/app/(app)/books/actions");
    await refreshMetadata("6dae4f44-5c91-4d85-9c66-2e8e6dae4f44");
    expect(providersOf(spies.refreshFor.mock.calls[0])).toEqual(["openlibrary"]);
  });
});
