import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims, getUser } }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
const redirect = vi.fn((to: string): never => {
  throw new Error(`REDIRECT ${to}`);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
// `cache` memoises per request; in a test every call is its own request.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

import { requireUser } from "./library";

beforeEach(() => {
  getClaims.mockReset();
  getUser.mockReset();
  redirect.mockClear();
});

describe("requireUser", () => {
  it("reads the verified claims and never calls the auth server", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "user-1", email: "a@example.com" } }, error: null });
    await expect(requireUser()).resolves.toEqual({ id: "user-1", email: "a@example.com" });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("returns a null email when the token carries none", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "user-2" } }, error: null });
    await expect(requireUser()).resolves.toEqual({ id: "user-2", email: null });
  });

  it("sends a signed-out visitor to sign-in", async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error("no session") });
    await expect(requireUser()).rejects.toThrow("REDIRECT /sign-in");
    getClaims.mockResolvedValue({ data: { claims: {} }, error: null });
    await expect(requireUser()).rejects.toThrow("REDIRECT /sign-in");
    expect(redirect).toHaveBeenCalledWith("/sign-in");
  });
});
