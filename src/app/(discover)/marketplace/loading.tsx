import { SkeletonCardGrid } from "@/components/ui/skeleton";

export default function Loading() {
  return <div className="marketplace-loading"><SkeletonCardGrid label="Loading parts" cards={8} /></div>;
}
