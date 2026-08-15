import { SkeletonLedger } from "@/components/ui/skeleton";

/** The console had no loading feedback at all — every page is
 *  force-dynamic, so navigation blocked silently on queries. */
export default function Loading() {
  return <SkeletonLedger />;
}
