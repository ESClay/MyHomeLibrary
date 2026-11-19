import { HeaderSkeleton, RowCardsSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage label="Loading">
      <HeaderSkeleton lede />
      <RowCardsSkeleton count={3} />
      <span className="h-11 w-full animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
    </SkeletonPage>
  );
}
