import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { fullAccessResponse, hasFullAccess } from "@/lib/access";
import { processScanPhoto } from "@/lib/scan/process";
import type { ScanItem } from "@/lib/scan/resolve";
import { createClient } from "@/lib/supabase/server";

// A full shelf at high effort can take a minute or more, then every title is looked up. Vercel's
// default would cut that off, so ask for the platform maximum for this route.
export const maxDuration = 300;

type Failure = { ok: false; error: string; kind: string };
const failure = (status: number, kind: string, error: string) =>
  NextResponse.json({ ok: false, error, kind } satisfies Failure, { status });

/**
 * POST /api/scan/<job id>: reads the job's photo, identifies the books, resolves each against the
 * catalogue and the library, stores the result on the job and returns it.
 */
export async function POST(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = z.string().uuid().safeParse((await ctx.params).id);
  if (!id.success) return failure(400, "bad_request", "That scan is not valid.");

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return failure(401, "auth", "Sign in first.");
  // Claude reads the photo and Hardcover/Google resolve the titles: full access only, checked before anything is claimed or sent.
  if (!(await hasFullAccess(supabase, auth.user.id))) return fullAccessResponse({ kind: "full_access_required" });

  const { data: job } = await supabase
    .from("scan_jobs")
    .select("id, library_id, photo_path, status, detected, photo_deleted_at")
    .eq("id", id.data)
    .maybeSingle();
  if (!job) return failure(404, "not_found", "That scan could not be found.");
  if (job.status === "ready" || job.status === "saved") {
    return NextResponse.json({ ok: true, items: job.detected as ScanItem[], dropped: 0 });
  }
  if (job.photo_deleted_at) return failure(410, "gone", "That photo has already been cleared. Take it again.");

  const outcome = await processScanPhoto(supabase, job);
  if (!outcome.ok) return failure(outcome.status, outcome.kind, outcome.error);
  return NextResponse.json({ ok: true, items: outcome.items, dropped: outcome.dropped });
}
