import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OAuthButtons } from "./oauth-buttons";

const html = () => renderToStaticMarkup(createElement(OAuthButtons, { next: "/library" }));

afterEach(() => vi.unstubAllEnvs());

describe("OAuth buttons", () => {
  it("always shows Google", () => {
    expect(html()).toContain("Continue with Google");
  });
  it("hides Apple unless NEXT_PUBLIC_APPLE_SIGNIN_ENABLED is exactly true", () => {
    expect(html()).not.toContain("Continue with Apple");
    vi.stubEnv("NEXT_PUBLIC_APPLE_SIGNIN_ENABLED", "false");
    expect(html()).not.toContain("Continue with Apple");
    vi.stubEnv("NEXT_PUBLIC_APPLE_SIGNIN_ENABLED", "true");
    expect(html()).toContain("Continue with Apple");
  });
});
