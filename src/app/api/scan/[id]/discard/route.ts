import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { deleteScanPhoto } from "@/lib/scan/jobs";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/scan/<job id>/discard[?saved=1]: deletes the scan photo (Storage API) once the review is
 * saved or abandoned. Also the target of a leave-the-page beacon, so it takes no body and is idempotent.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = z.string().uuid().safeParse((await ctx.params).id);
  if (!id.success) return NextResponse.json({ ok: false }, { status: 400 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false }, { status: 401 });

  const { data: job } = await supabase.from("scan_jobs").select("id, photo_path, photo_deleted_at").eq("id", id.data).maybeSingle();
  if (!job) return NextResponse.json({ ok: true }); // nothing of theirs to clear
  if (job.photo_deleted_at) return NextResponse.json({ ok: true });
  const saved = request.nextUrl.searchParams.get("saved") === "1";
  const ok = await deleteScanPhoto(supabase, job, saved ? "saved" : undefined);
  return NextResponse.json({ ok }, { status: ok ? 200 : 502 });
}
