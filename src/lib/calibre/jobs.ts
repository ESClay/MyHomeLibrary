import "server-only";
import { jobMappingSchema, readSummary, type ImportSummary, type JobMapping } from "./plan";
import { createClient } from "@/lib/supabase/server";

export type ActiveImport = {
  id: string;
  total: number;
  processed: number;
  summary: ImportSummary;
  mapping: JobMapping;
};

/**
 * The person's unfinished import in this library, if any. A job whose upload never finished (the tab closed
 * halfway) is closed and not offered, because it does not hold every reviewed row.
 */
export async function loadActiveImport(libraryId: string, userId: string): Promise<ActiveImport | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("import_jobs")
    .select("id, status, total, processed, mapping, summary")
    .eq("library_id", libraryId)
    .eq("user_id", userId)
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const mapping = jobMappingSchema.safeParse(data.mapping);
  if (!mapping.success || data.total !== mapping.data.expected || data.processed >= data.total) {
    await supabase.from("import_jobs").update({ status: data.processed >= data.total && data.total > 0 ? "done" : "cancelled" }).eq("id", data.id);
    return null;
  }
  return { id: data.id, total: data.total, processed: data.processed, summary: readSummary(data.summary), mapping: mapping.data };
}
