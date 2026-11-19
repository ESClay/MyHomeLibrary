import { vi } from "vitest";

type Row = Record<string, unknown>;

/**
 * A tiny in-memory stand-in for the Supabase query builder: `from(table).select().eq().in().gt().gte().not().order().limit()`
 * resolves to `{ data, error }`, filtering the rows given per table. Enough for the cron tasks and the access helper;
 * not a Supabase emulator. Calls are recorded in `calls` so a test can assert which tables were read.
 */
export function fakeSupabase(tables: Record<string, Row[]>, rpc: (fn: string, args: Row) => unknown = () => null) {
  const calls: { table: string; filters: string[] }[] = [];
  const writes: { table: string; op: "insert" | "update" | "delete" | "upsert"; row?: unknown }[] = [];
  function builder(table: string) {
    const filters: string[] = [];
    let rows = [...(tables[table] ?? [])];
    const api = {
      select: () => api,
      insert: (row: unknown) => {
        writes.push({ table, op: "insert", row });
        rows = [{ id: "new-row" }];
        return api;
      },
      update: (row: unknown) => {
        writes.push({ table, op: "update", row });
        return api;
      },
      upsert: (row: unknown) => {
        writes.push({ table, op: "upsert", row });
        return api;
      },
      delete: () => {
        writes.push({ table, op: "delete" });
        return api;
      },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      eq: (col: string, val: unknown) => {
        filters.push(`eq ${col}`);
        rows = rows.filter((r) => r[col] === val);
        return api;
      },
      in: (col: string, vals: unknown[]) => {
        filters.push(`in ${col}`);
        rows = rows.filter((r) => vals.includes(r[col]));
        return api;
      },
      gt: (col: string, val: string) => {
        filters.push(`gt ${col}`);
        rows = rows.filter((r) => String(r[col]) > val);
        return api;
      },
      gte: () => api,
      not: () => api,
      order: (col: string) => {
        rows.sort((a, b) => String(a[col]).localeCompare(String(b[col])));
        return api;
      },
      range: (from: number, to: number) => {
        rows = rows.slice(from, to + 1);
        return api;
      },
      limit: (n: number) => {
        rows = rows.slice(0, n);
        return api;
      },
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
        calls.push({ table, filters });
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return api;
  }
  return {
    from: vi.fn((table: string) => builder(table)),
    rpc: vi.fn(async (fn: string, args: Row) => ({ data: rpc(fn, args), error: null })),
    calls,
    writes,
  };
}
