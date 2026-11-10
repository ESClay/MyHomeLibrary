import type { Metadata } from "next";
import { AuthScreen } from "../auth-screen";

export const metadata: Metadata = { title: "Sign up" };

export default function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  return <AuthScreen mode="sign-up" searchParams={searchParams} />;
}
