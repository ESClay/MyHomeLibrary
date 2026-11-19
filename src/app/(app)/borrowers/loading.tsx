import { HeaderSkeleton, RowCardsSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage gap="gap-6" label="Loading borrowers">
      <span className="block h-4 w-20 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
      <HeaderSkeleton lede />
      <RowCardsSkeleton count={3} />
    </SkeletonPage>
  );
}
