import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ admin: false, rpc: vi.fn() }));
const TARGET = "2f6e1a52-8f33-4c1b-9b9e-0f5b3a7d1c11";

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/library", () => ({ requireUser: async () => ({ id: "me" }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "is_app_admin") return { data: state.admin, error: null };
      return state.rpc(fn, args);
    },
  }),
}));

beforeEach(() => {
  state.admin = false;
  state.rpc.mockReset().mockResolvedValue({ data: null, error: null });
});

describe("setFullAccess", () => {
  it("refuses a non-admin before calling the database function", async () => {
    const { setFullAccess } = await import("./actions");
    const res = await setFullAccess({ userId: TARGET, enabled: true });
    expect(res).toEqual({ ok: false, error: "Only an app admin can change access." });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("calls set_full_access for an admin", async () => {
    state.admin = true;
    const { setFullAccess } = await import("./actions");
    expect(await setFullAccess({ userId: TARGET, enabled: false })).toEqual({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith("set_full_access", { target: TARGET, enabled: false });
  });

  it("rejects a malformed id", async () => {
    state.admin = true;
    const { setFullAccess } = await import("./actions");
    expect((await setFullAccess({ userId: "nope", enabled: true })).ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("reports a database refusal without leaking its text", async () => {
    state.admin = true;
    state.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "internal detail" } });
    const { setFullAccess } = await import("./actions");
    expect(await setFullAccess({ userId: TARGET, enabled: true })).toEqual({ ok: false, error: "Could not change access. Try again." });
  });
});
