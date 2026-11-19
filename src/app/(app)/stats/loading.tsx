import { HeaderSkeleton, PanelSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage width="max-w-5xl" gap="gap-6" label="Loading stats">
      <HeaderSkeleton lede />
      <div className="grid gap-4 sm:grid-cols-3">
        <PanelSkeleton rows={1} className="p-5 md:p-5" />
        <PanelSkeleton rows={1} className="p-5 md:p-5" />
        <PanelSkeleton rows={1} className="p-5 md:p-5" />
      </div>
      <PanelSkeleton rows={4} />
    </SkeletonPage>
  );
}
