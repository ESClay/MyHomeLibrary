import { CoverGridSkeleton, HeaderSkeleton, SkeletonPage, ToolbarSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage width="max-w-6xl" gap="gap-6" label="Loading your library">
      <HeaderSkeleton />
      <ToolbarSkeleton />
      <CoverGridSkeleton />
    </SkeletonPage>
  );
}
