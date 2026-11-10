import type { Metadata } from "next";
import { AuthScreen } from "../auth-screen";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return <AuthScreen mode="sign-in" searchParams={searchParams} />;
}
