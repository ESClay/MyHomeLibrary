import { CoverGridSkeleton, HeaderSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage width="max-w-6xl" gap="gap-6" label="Loading the shelf">
      <HeaderSkeleton lede />
      <CoverGridSkeleton count={10} />
    </SkeletonPage>
  );
}
