/** One account as the admin page shows it (a row of admin_list_accounts). */
export type AdminAccount = {
  userId: string;
  displayName: string | null;
  email: string | null;
  createdAt: string;
  fullAccess: boolean;
  isAdmin: boolean;
  libraryCount: number;
};

type Row = {
  user_id: string;
  display_name: string | null;
  email: string | null;
  created_at: string;
  full_access: boolean;
  is_admin: boolean;
  library_count: number | string;
};

export function toAccount(r: Row): AdminAccount {
  return {
    userId: r.user_id,
    displayName: r.display_name,
    email: r.email,
    createdAt: r.created_at,
    fullAccess: r.full_access,
    isAdmin: r.is_admin,
    libraryCount: Number(r.library_count),
  };
}

/** Accounts whose name or email contains every word typed, ignoring case and accents. */
export function filterAccounts(accounts: AdminAccount[], query: string): AdminAccount[] {
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return accounts;
  return accounts.filter((a) => {
    const hay = fold(`${a.displayName ?? ""} ${a.email ?? ""}`);
    return words.every((w) => hay.includes(w));
  });
}
