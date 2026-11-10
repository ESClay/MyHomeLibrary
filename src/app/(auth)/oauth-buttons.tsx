"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type Provider = "google" | "apple";

export function OAuthButtons({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);

  async function signInWith(provider: Provider) {
    setError(null);
    try {
      const { error } = await createClient().auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) setError(error.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start sign-in.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" size="lg" className="h-10" onClick={() => signInWith("google")}>
        Continue with Google
      </Button>
      <Button type="button" variant="outline" size="lg" className="h-10" onClick={() => signInWith("apple")}>
        Continue with Apple
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
