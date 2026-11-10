import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { acceptInvite } from "./actions";

export const metadata: Metadata = { title: "Join library" };

export default async function InvitePage({
  params,
  searchParams,
}: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const { error } = await searchParams;

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    // Preserve the invite through sign-in.
    redirect(`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  return (
    <div className="flex flex-col gap-6 text-center">
      <h1 className="text-2xl font-semibold">You&apos;ve been invited</h1>
      <p className="text-sm text-muted-foreground">
        Join the shared library as {data.user.email}.
      </p>
      {typeof error === "string" && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <form action={acceptInvite}>
        <input type="hidden" name="token" value={token} />
        <Button type="submit" size="lg" className="h-10 w-full">
          Join library
        </Button>
      </form>
    </div>
  );
}
