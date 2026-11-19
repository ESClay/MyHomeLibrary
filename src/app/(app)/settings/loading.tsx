import { HeaderSkeleton, PanelSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage width="max-w-2xl" gap="gap-6" label="Loading settings">
      <HeaderSkeleton />
      <PanelSkeleton rows={2} />
      <PanelSkeleton rows={3} />
      <PanelSkeleton rows={2} />
    </SkeletonPage>
  );
}
