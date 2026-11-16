import type { Metadata } from "next";
import { PageHeader } from "@/components/shelf";
import { getLibraryContext } from "@/lib/library";
import type { Person } from "@/lib/stats/aggregate";
import { loadStats } from "@/lib/stats/data";
import { loadMemberNames } from "@/lib/shelves/data";
import { StatsView } from "./stats-view";

export const metadata: Metadata = { title: "Stats" };

export default async function StatsPage() {
  const { user, current, currency } = await getLibraryContext();
  if (!current) return null; // The layout shows the create-library prompt.

  const [stats, names] = await Promise.all([loadStats(current.id, currency), loadMemberNames(current.id)]);
  const people: Person[] = [...names].map(([id, name]) => ({ id, name, isMe: id === user.id }));
  if (!people.some((p) => p.isMe)) people.push({ id: user.id, name: "You", isMe: true });
  // You first, then the others in the order they joined.
  people.sort((a, b) => Number(b.isMe) - Number(a.isMe));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader eyebrow={current.name} title="Stats" lede="What you read, what the shelves are worth, what you collect, and how the library grows." />
      <StatsView stats={stats} people={people} currency={currency} nowIso={new Date().toISOString()} />
    </div>
  );
}
