import { HeaderSkeleton, PanelSkeleton, PickCardsSkeleton, SkeletonPage } from "@/components/skeletons";

export default function Loading() {
  return (
    <SkeletonPage label="Loading Discover">
      <HeaderSkeleton lede />
      <PanelSkeleton rows={2} />
      <div className="panel flex flex-col gap-6 p-5 md:p-8">
        <PanelSkeleton rows={0} className="border-0 bg-transparent p-0 shadow-none md:p-0" />
        <PickCardsSkeleton />
      </div>
    </SkeletonPage>
  );
}
