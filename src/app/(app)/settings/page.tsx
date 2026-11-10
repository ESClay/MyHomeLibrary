import type { Metadata } from "next";
import { CopyLinkButton } from "@/components/copy-link-button";
import { CreateLibraryForm } from "@/components/create-library-form";
import { InviteForm } from "@/components/invite-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getLibraryContext } from "@/lib/library";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../../(auth)/actions";
import { removeMember, renameLibrary, revokeInvite } from "./actions";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { user, current } = await getLibraryContext();
  if (!current) return null; // The layout shows the create-library prompt.

  const isOwner = current.role === "owner";
  const supabase = await createClient();

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
      <h1 className="text-2xl font-semibold">Settings</h1>

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
                <Input id="rename" name="name" defaultValue={current.name} required maxLength={100} className="h-10 text-base" />
              </div>
              <Button type="submit" className="h-10">
                Rename
              </Button>
            </form>
          ) : (
            <p>{current.name}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y">
            {(members ?? []).map((m) => {
              const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
              return (
                <li key={m.user_id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
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
                <h3 className="text-sm font-medium">Pending invites</h3>
                <ul className="flex flex-col divide-y">
                  {(invites ?? []).map((inv) => (
                    <li key={inv.id} className="flex flex-col gap-2 py-2">
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
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          <form action={signOut}>
            <Button type="submit" variant="outline" className="h-10">
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
