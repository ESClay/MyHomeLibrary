import type { Metadata } from "next";
import { CopyLinkButton } from "@/components/copy-link-button";
import { CreateLibraryForm } from "@/components/create-library-form";
import { InviteForm } from "@/components/invite-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shelf";
import { isAppAdmin } from "@/lib/access";
import { getLibraryContext } from "@/lib/library";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { BarChart3, ChevronRight, ShieldCheck, Users } from "lucide-react";
import { PriceRegionForm, RegionForm } from "./region-forms";
import { signOut } from "../../(auth)/actions";
import { removeMember, renameLibrary, revokeInvite } from "./actions";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { user, current, region, locale } = await getLibraryContext();
  if (!current) return null; // The layout shows the create-library prompt.

  const isOwner = current.role === "owner";
  const supabase = await createClient();
  const admin = await isAppAdmin(supabase, user.id);

  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase
      .from("library_members")
      .select("user_id, role, profiles(display_name, email)")
      .eq("library_id", current.id)
      .order("created_at"),
    isOwner
      ? supabase
          .from("library_invites")
          .select("id, email, role, token, expires_at")
          .eq("library_id", current.id)
          .is("accepted_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageHeader eyebrow="Profile" title="Settings" />

      <Card>
        <CardHeader>
          <CardTitle>Library</CardTitle>
        </CardHeader>
        <CardContent>
          {isOwner ? (
            <form action={renameLibrary} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <input type="hidden" name="libraryId" value={current.id} />
              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor="rename">Name</Label>
                <Input id="rename" name="name" defaultValue={current.name} required maxLength={100} />
              </div>
              <Button type="submit">
                Rename
              </Button>
            </form>
          ) : (
            <p className="font-display text-lg">{current.name}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Prices</CardTitle>
        </CardHeader>
        <CardContent>
          {isOwner ? (
            <PriceRegionForm libraryId={current.id} priceRegion={current.priceRegion} locale={locale} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {current.priceRegion ? `Prices in this library use the ${current.priceRegion.replace("EBAY_", "")} marketplace. Only the owner can change that.` : "The owner has not chosen a price region yet, so prices are off."}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { href: "/stats", title: "Stats", body: "What you read, what the shelves are worth, and how the library grows.", Icon: BarChart3 },
          { href: "/borrowers", title: "Borrowers", body: "Who has your books, and who you borrowed from.", Icon: Users },
          ...(admin ? [{ href: "/admin", title: "Admin", body: "Choose who has full access: photos, picks, prices and richer lookups.", Icon: ShieldCheck }] : []),
        ].map(({ href, title, body, Icon }) => (
          <Link
            key={href}
            href={href}
            className="panel group flex min-h-[4.5rem] items-center gap-3 p-4 transition-[transform,border-color] duration-[var(--dur-fast)] hover:-translate-y-0.5 hover:border-foreground/30 active:translate-y-px"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Icon className="size-5" strokeWidth={1.5} aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-lg leading-snug font-medium">{title}</span>
              <span className="text-sm text-muted-foreground">{body}</span>
            </span>
            <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground transition-transform duration-[var(--dur-fast)] group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y divide-border">
            {(members ?? []).map((m) => {
              const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
              return (
                <li key={m.user_id} className="flex items-center justify-between gap-3 py-3">
                  <span
                    aria-hidden
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent font-display text-lg text-accent-foreground"
                  >
                    {(profile?.display_name ?? profile?.email ?? "?").charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {profile?.display_name ?? profile?.email ?? "Member"}
                      {m.user_id === user.id && " (you)"}
                    </p>
                    {profile?.email && <p className="truncate text-sm text-muted-foreground">{profile.email}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="secondary">{m.role}</Badge>
                    {isOwner && m.role !== "owner" && (
                      <form action={removeMember}>
                        <input type="hidden" name="libraryId" value={current.id} />
                        <input type="hidden" name="userId" value={m.user_id} />
                        <Button type="submit" variant="destructive" size="sm">
                          Remove
                        </Button>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle>Invite someone</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <InviteForm libraryId={current.id} />
            {(invites ?? []).length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="eyebrow">Pending invites</h3>
                <ul className="flex flex-col divide-y divide-border">
                  {(invites ?? []).map((inv) => (
                    <li key={inv.id} className="flex flex-col gap-2 py-3">
                      <p className="truncate text-sm">
                        {inv.email} <Badge variant="secondary">{inv.role}</Badge>
                      </p>
                      <div className="flex gap-2">
                        <CopyLinkButton path={`/invite/${inv.token}`} />
                        <form action={revokeInvite}>
                          <input type="hidden" name="inviteId" value={inv.id} />
                          <Button type="submit" variant="destructive" size="sm">
                            Revoke
                          </Button>
                        </form>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>New library</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateLibraryForm submitLabel="Create another library" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Region and language</CardTitle>
        </CardHeader>
        <CardContent>
          <RegionForm region={region ?? "EBAY_US"} locale={locale} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          <form action={signOut}>
            <Button type="submit" variant="outline">
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
