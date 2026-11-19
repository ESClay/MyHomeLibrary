import "server-only";
import { cache } from "react";
import { buildLibraryIndex } from "@/lib/discover/match";
import { loadFeedback, loadLibraryBooks } from "@/lib/discover/recs";
import { createClient } from "@/lib/supabase/server";

/*
 * Reads several Discover sections share. Each is memoised for the request, so sections that render side by side
 * (and stream independently) ask the database once.
 */

export const getLibraryBooks = cache(async (libraryId: string) => loadLibraryBooks(await createClient(), libraryId));

export const getLibraryIndex = cache(async (libraryId: string) => buildLibraryIndex(await getLibraryBooks(libraryId)));

/** Work keys the person marked not interested, already read or wishlisted: no longer shown. */
export const getDeclined = cache(async (userId: string) => new Set((await loadFeedback(await createClient(), [userId])).map((f) => f.workKey)));
