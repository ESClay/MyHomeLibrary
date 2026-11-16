import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/supabase-fake";

// React's request cache memoizes per request on the server. Here one "request" lasts until resetModules().
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
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

const server = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => server.client }));
const adminMock = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (!adminMock.client) throw new Error("not configured");
    return adminMock.client;
  },
}));

const ME = "11111111-1111-1111-1111-111111111111";
const GRANTED = new Set<string>();
const ADMINS = new Set<string>();

function userClient(userId: string | null) {
  const fake = fakeSupabase({}, (fn, args) => (fn === "has_full_access" ? GRANTED.has(args.uid as string) : ADMINS.has(args.uid as string)));
  return Object.assign(fake, { auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) } });
}

async function load() {
  vi.resetModules();
  return import("./access");
}

beforeEach(() => {
  GRANTED.clear();
  ADMINS.clear();
  adminMock.client = null;
});

describe("hasFullAccess", () => {
  it("is true for a granted person and false for an ungranted one", async () => {
    const { hasFullAccess } = await load();
    GRANTED.add(ME);
    expect(await hasFullAccess(userClient(ME) as never, ME)).toBe(true);
    expect(await hasFullAccess(userClient(null) as never, "someone-else")).toBe(false);
  });

  it("fails closed when the database errors", async () => {
    const { hasFullAccess } = await load();
    const broken = { rpc: async () => ({ data: true, error: { message: "boom" } }) };
    expect(await hasFullAccess(broken as never, ME)).toBe(false);
  });

  it("asks the database once per person per request", async () => {
    const { hasFullAccess } = await load();
    GRANTED.add(ME);
    const client = userClient(ME);
    await Promise.all([hasFullAccess(client as never, ME), hasFullAccess(client as never, ME)]);
    await hasFullAccess(userClient(ME) as never, ME);
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("does not carry an answer into the next request", async () => {
    GRANTED.add(ME);
    const first = await load();
    expect(await first.hasFullAccess(userClient(ME) as never, ME)).toBe(true);
    GRANTED.delete(ME);
    const second = await load();
    expect(await second.hasFullAccess(userClient(ME) as never, ME)).toBe(false);
  });
});

describe("isAppAdmin", () => {
  it("reads the admin flag separately from full access", async () => {
    const { isAppAdmin, hasFullAccess } = await load();
    ADMINS.add(ME);
    const client = userClient(ME);
    expect(await isAppAdmin(client as never, ME)).toBe(true);
    expect(await hasFullAccess(client as never, ME)).toBe(false); // an admin is not implicitly granted
  });
});

describe("requireFullAccess", () => {
  it("returns the person and client when granted", async () => {
    const { requireFullAccess } = await load();
    GRANTED.add(ME);
    server.client = userClient(ME);
    const res = await requireFullAccess();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.user.id).toBe(ME);
  });

  it("returns the typed denial when ungranted or signed out", async () => {
    const { requireFullAccess, FULL_ACCESS_NEEDED } = await load();
    server.client = userClient(ME);
    expect(await requireFullAccess()).toEqual({ ok: false, error: FULL_ACCESS_NEEDED, code: "full_access_required" });
    const again = await load();
    server.client = userClient(null);
    expect(await again.requireFullAccess()).toMatchObject({ ok: false, code: "full_access_required" });
  });

  it("answers a route with a 403 carrying the message", async () => {
    const { fullAccessResponse, FULL_ACCESS_NEEDED } = await load();
    const res = fullAccessResponse({ kind: "x" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, kind: "x", error: FULL_ACCESS_NEEDED, code: "full_access_required" });
  });
});

describe("providerPolicyFor", () => {
  it("gives everything to a granted person and Open Library only to the rest", async () => {
    const { providerPolicyFor } = await load();
    GRANTED.add(ME);
    expect((await providerPolicyFor(userClient(ME) as never, ME)).providers).toEqual(["hardcover", "google", "openlibrary"]);
    const other = await load();
    expect((await other.providerPolicyFor(userClient(ME) as never, "nobody")).providers).toEqual(["openlibrary"]);
  });
});

describe("library-level checks (service role)", () => {
  const tables = () => ({
    library_members: [
      { library_id: "L1", user_id: "alice" },
      { library_id: "L1", user_id: "bob" },
      { library_id: "L2", user_id: "carol" },
    ],
    user_entitlements: [
      { user_id: "bob", full_access: true },
      { user_id: "carol", full_access: false },
    ],
  });

  it("is true when any member is granted, false when none is", async () => {
    const { libraryHasGrantedMember } = await load();
    adminMock.client = fakeSupabase(tables());
    expect(await libraryHasGrantedMember("L1")).toBe(true);
    expect(await libraryHasGrantedMember("L2")).toBe(false);
    expect(await libraryHasGrantedMember("L-missing")).toBe(false);
  });

  it("is false when the service role is not configured", async () => {
    const { libraryHasGrantedMember } = await load();
    expect(await libraryHasGrantedMember("L1")).toBe(false);
  });

  it("caches the answer per library for the request", async () => {
    const { libraryHasGrantedMember } = await load();
    const admin = fakeSupabase(tables());
    adminMock.client = admin;
    await libraryHasGrantedMember("L1");
    await libraryHasGrantedMember("L1");
    expect(admin.from).toHaveBeenCalledTimes(2); // one members read and one entitlements read, once
  });

  it("lists granted users and libraries for the cron", async () => {
    const { grantedUserIds, grantedLibraryIds } = await load();
    const admin = fakeSupabase(tables());
    expect([...(await grantedUserIds(admin as never))]).toEqual(["bob"]);
    expect([...(await grantedLibraryIds(admin as never))]).toEqual(["L1"]);
  });
});
