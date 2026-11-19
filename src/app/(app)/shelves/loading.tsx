import { HeaderSkeleton, PanelSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage width="max-w-4xl" label="Loading your shelves">
      <HeaderSkeleton lede />
      <PanelSkeleton rows={2} />
      <PanelSkeleton rows={2} />
      <PanelSkeleton rows={2} />
    </SkeletonPage>
  );
}
