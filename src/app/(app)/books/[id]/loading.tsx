import { HeaderSkeleton, PanelSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage width="max-w-5xl" label="Loading the book">
      <span className="block h-4 w-20 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
      <div className="flex gap-5 md:gap-8">
        <div className="book-cover w-28 shrink-0 animate-pulse motion-reduce:animate-none md:w-48" />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <HeaderSkeleton lede />
          <span className="block h-3 w-1/3 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
        </div>
      </div>
      <PanelSkeleton rows={3} />
      <PanelSkeleton rows={2} />
    </SkeletonPage>
  );
}
