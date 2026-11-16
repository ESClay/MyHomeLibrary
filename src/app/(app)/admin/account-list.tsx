"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { useLocale } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { filterAccounts, type AdminAccount } from "@/lib/admin";
import { formatDate } from "@/lib/regions";
import { cn } from "@/lib/utils";
import { setFullAccess } from "./actions";

/** A labelled on/off switch with a 44px target. */
function Switch({ checked, busy, label, onChange }: { checked: boolean; busy: boolean; label: string; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={busy}
      onClick={onChange}
      className="group -m-1.5 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-wait disabled:opacity-60"
    >
      <span
        aria-hidden
        className={cn(
          "relative h-6 w-11 rounded-full border transition-colors duration-[var(--dur-fast)]",
          checked ? "border-primary bg-primary" : "border-input bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-4.5 rounded-full bg-card shadow-sm transition-transform duration-[var(--dur-fast)] group-active:scale-95",
            checked && "translate-x-5",
          )}
        />
      </span>
    </button>
  );
}

export function AccountList({ accounts: initial, meId }: { accounts: AdminAccount[]; meId: string }) {
  const router = useRouter();
  const locale = useLocale();
  const [accounts, setAccounts] = useState(initial);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmSelf, setConfirmSelf] = useState(false);
  const [, startTransition] = useTransition();

  const shown = useMemo(() => filterAccounts(accounts, query), [accounts, query]);

  function apply(account: AdminAccount, enabled: boolean) {
    setError(null);
    setBusy(account.userId);
    startTransition(async () => {
      const res = await setFullAccess({ userId: account.userId, enabled });
      if (res.ok) {
        setAccounts((list) => list.map((a) => (a.userId === account.userId ? { ...a, fullAccess: enabled } : a)));
        router.refresh();
      } else setError(res.error);
      setBusy(null);
    });
  }

  function toggle(account: AdminAccount) {
    const enabled = !account.fullAccess;
    // Turning off your own access is the one change worth a second look: it locks you out of the paid features.
    if (!enabled && account.userId === meId) setConfirmSelf(true);
    else apply(account, enabled);
  }

  const me = accounts.find((a) => a.userId === meId);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Search by name or email"
          placeholder="Search by name or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
          className="pl-9"
        />
      </div>

      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {query.trim() ? `${shown.length} of ${accounts.length} accounts` : `${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}`}
      </p>
      {error && (
        <p role="alert" className="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="panel p-5 text-base text-muted-foreground">{query.trim() ? "No account matches that search." : "There are no accounts yet."}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((a) => {
            const name = a.displayName || a.email || "Account";
            const isMe = a.userId === meId;
            return (
              <li key={a.userId} data-testid="account-row" className="panel flex items-center gap-3 p-4">
                <Avatar name={name} url={null} className="size-10 text-base" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-medium">
                      {name}
                      {isMe && " (you)"}
                    </span>
                    {a.isAdmin && <Badge variant="secondary">Admin</Badge>}
                  </p>
                  {a.email && a.email !== name && <p className="truncate text-sm text-muted-foreground">{a.email}</p>}
                  <p className="text-sm text-muted-foreground">
                    Joined {formatDate(a.createdAt, locale)} · {a.libraryCount} {a.libraryCount === 1 ? "library" : "libraries"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-center gap-0.5">
                  <Switch checked={a.fullAccess} busy={busy === a.userId} label={`Full access for ${name}`} onChange={() => toggle(a)} />
                  <span aria-hidden className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                    {a.fullAccess ? "Full" : "Basic"}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {confirmSelf && me && (
        <Sheet open onOpenChange={(open) => !open && setConfirmSelf(false)}>
          <SheetContent title="Turn off your own full access?" description="You stay an admin and can turn it back on here.">
            <div className="flex flex-col gap-4 px-5 py-5">
              <p className="text-base">
                Photo recognition, recommendations, market prices and the richer book lookups will lock for your account until you turn it on again.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setConfirmSelf(false)}>
                  Keep full access
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    setConfirmSelf(false);
                    apply(me, false);
                  }}
                >
                  Turn off my access
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
