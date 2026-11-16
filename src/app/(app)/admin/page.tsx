import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shelf";
import { isAppAdmin } from "@/lib/access";
import { toAccount } from "@/lib/admin";
import { requireUser } from "@/lib/library";
import { createClient } from "@/lib/supabase/server";
import { AccountList } from "./account-list";

export const metadata: Metadata = { title: "Admin" };

/** Admins only. Anyone else gets the same 404 as a page that does not exist, so the route is not advertised. */
export default async function Page() {
  const user = await requireUser();
  const supabase = await createClient();
  if (!(await isAppAdmin(supabase, user.id))) notFound();

  const { data, error } = await supabase.rpc("admin_list_accounts");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        eyebrow="Admin"
        title="Accounts"
        lede="Full access turns on photo recognition, recommendations, market prices and the richer book lookups for one account."
      />
      {error ? (
        <p role="alert" className="panel p-5 text-base text-destructive">
          The account list could not be loaded. Refresh the page to try again.
        </p>
      ) : (
        <AccountList accounts={(data ?? []).map(toAccount)} meId={user.id} />
      )}
    </div>
  );
}
