import { safeNext } from "@/lib/redirect";
import { AuthForm } from "./auth-form";
import { OAuthButtons } from "./oauth-buttons";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function AuthScreen({
  mode,
  searchParams,
}: {
  mode: "sign-in" | "sign-up";
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : undefined);
  const error = typeof params.error === "string" ? params.error : undefined;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-center text-2xl font-semibold">
        {mode === "sign-in" ? "Sign in" : "Create your account"}
      </h1>
      {error && (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      )}
      <OAuthButtons next={next} />
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <AuthForm mode={mode} next={next} />
    </div>
  );
}
