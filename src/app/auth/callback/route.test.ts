import { beforeEach, describe, expect, it, vi } from "vitest";

const exchange = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { exchangeCodeForSession: exchange } }) }));

const get = async (query: string) => (await import("./route")).GET({ url: `http://localhost:3000/auth/callback${query}` } as never);

beforeEach(() => exchange.mockReset());

/**
 * A first-time Google sign-in lands here with a code. The callback only trades it for a session: the profile row is made by
 * the handle_new_user trigger (checked in supabase/tests/rls.test.sql) and the "Choose your region" step is shown by the app
 * layout while profiles.region is empty, so the person is sent on to `next` and meets that step there.
 */
describe("OAuth callback", () => {
  it("exchanges the code and sends a new Google user on to the app", async () => {
    exchange.mockResolvedValue({ error: null });
    const res = await get("?code=abc&next=%2Flibrary");
    expect(exchange).toHaveBeenCalledWith("abc");
    expect(res.headers.get("location")).toBe("http://localhost:3000/library");
  });

  it("falls back to the library for an unsafe next", async () => {
    exchange.mockResolvedValue({ error: null });
    const res = await get("?code=abc&next=https%3A%2F%2Fevil.example");
    expect(res.headers.get("location")).toBe("http://localhost:3000/library");
  });

  it("sends a failed exchange or a missing code back to sign-in with a message", async () => {
    exchange.mockResolvedValue({ error: { message: "bad" } });
    expect((await get("?code=abc")).headers.get("location")).toContain("/sign-in?error=");
    expect((await get("")).headers.get("location")).toContain("/sign-in?error=");
  });
});
