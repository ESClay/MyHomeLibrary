import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "2f6e1a52-8f33-4c1b-9b9e-0f5b3a7d1c11";
const LIB = "3a7d1c11-2f6e-4a52-8f33-9b9e0f5b3a7d";
const mine = (n: number) => `${LIB}/${USER}/7ebf5a55-6da2-4e96-8d77-3f9f7ebf5a5${n}.jpg`;

const state = vi.hoisted(() => ({ user: { id: "2f6e1a52-8f33-4c1b-9b9e-0f5b3a7d1c11" } as { id: string } | null, queued: [] as string[], removed: [] as string[][] }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({ select: () => ({ in: async () => ({ data: state.queued.map((photo_path) => ({ photo_path })) }) }) }),
    storage: { from: () => ({ remove: async (paths: string[]) => (state.removed.push(paths), { error: null }) }) },
  }),
}));

import { POST } from "./route";

const post = (body: unknown) => POST(new Request("http://x", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }) as never);

beforeEach(() => {
  state.user = { id: USER };
  state.queued = [];
  state.removed = [];
});

describe("POST /api/scan/discard-uploads", () => {
  it("removes uploaded photos that were never queued", async () => {
    const res = await post({ paths: [mine(1), mine(2)] });
    expect(await res.json()).toMatchObject({ ok: true, removed: 2 });
    expect(state.removed).toEqual([[mine(1), mine(2)]]);
  });

  it("keeps a photo that already belongs to a queued batch", async () => {
    state.queued = [mine(1)];
    const res = await post({ paths: [mine(1), mine(2)] });
    expect(await res.json()).toMatchObject({ removed: 1 });
    expect(state.removed).toEqual([[mine(2)]]);
  });

  it("never touches a path outside the caller's own folder", async () => {
    const res = await post({ paths: [`${LIB}/someone-else/7ebf5a55-6da2-4e96-8d77-3f9f7ebf5a55.jpg`, "../../etc/passwd"] });
    expect(await res.json()).toMatchObject({ ok: true, removed: 0 });
    expect(state.removed).toEqual([]);
  });

  it("rejects a signed-out caller and a bad body", async () => {
    expect((await post({ paths: [mine(1)] })).status).toBe(200);
    state.user = null;
    expect((await post({ paths: [mine(1)] })).status).toBe(401);
    state.user = { id: USER };
    expect((await post("not json")).status).toBe(400);
    expect((await post({ paths: "x" })).status).toBe(400);
  });
});
