import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isOwnScanPath, MAX_BATCH_PHOTOS } from "@/lib/scan/batch";
import { SCANS_BUCKET } from "@/lib/scan/jobs";
import { createClient } from "@/lib/supabase/server";

const body = z.object({ paths: z.array(z.string().max(200)).max(MAX_BATCH_PHOTOS) });

/**
 * POST /api/scan/discard-uploads { paths }: removes photos that were uploaded but never queued, when the person leaves
 * the page mid-upload. Also the target of a pagehide beacon. Only paths in the caller's own folder are touched, and a
 * photo that already has a scan job (it was queued) is always kept. Idempotent.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false }, { status: 401 });

  let parsed;
  try {
    parsed = body.safeParse(JSON.parse(await request.text()));
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  const own = [...new Set(parsed.data.paths)].filter((p) => isOwnScanPath(p, auth.user.id));
  if (own.length === 0) return NextResponse.json({ ok: true, removed: 0 });

  const { data: queued } = await supabase.from("scan_jobs").select("photo_path").in("photo_path", own);
  const kept = new Set((queued ?? []).map((r) => r.photo_path as string));
  const toRemove = own.filter((p) => !kept.has(p));
  if (toRemove.length === 0) return NextResponse.json({ ok: true, removed: 0 });

  const { error } = await supabase.storage.from(SCANS_BUCKET).remove(toRemove);
  return NextResponse.json({ ok: !error, removed: error ? 0 : toRemove.length }, { status: error ? 502 : 200 });
}
