import { describe, expect, it } from "vitest";
import { appleSignInEnabled } from "./auth-config";

describe("Apple sign-in toggle", () => {
  it("is on only for the exact string true", () => {
    expect(appleSignInEnabled("true")).toBe(true);
  });
  it.each([undefined, "", "false", "TRUE", "1", "yes", " true"])("is off for %j", (value) => {
    expect(appleSignInEnabled(value)).toBe(false);
  });
  it("reads NEXT_PUBLIC_APPLE_SIGNIN_ENABLED by default, which the test environment leaves unset", () => {
    expect(appleSignInEnabled()).toBe(process.env.NEXT_PUBLIC_APPLE_SIGNIN_ENABLED === "true");
  });
});
