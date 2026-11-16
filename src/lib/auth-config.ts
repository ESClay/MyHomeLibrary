/**
 * "Continue with Apple" stays hidden until Sign in with Apple is set up (it needs a paid Apple Developer account).
 * Set NEXT_PUBLIC_APPLE_SIGNIN_ENABLED=true (and rebuild: NEXT_PUBLIC values are inlined at build time) to show it.
 * Only the exact string "true" turns it on.
 */
export function appleSignInEnabled(value: string | undefined = process.env.NEXT_PUBLIC_APPLE_SIGNIN_ENABLED): boolean {
  return value === "true";
}
