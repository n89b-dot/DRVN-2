import type { Metadata } from "next";

import { MarketplacePageContent } from "@/features/marketplace/page-content";
import type { RawMarketplaceParams } from "@/lib/marketplace/state";

/**
 * Marketplace routes keep marketplace wording (F-2). The root description no
 * longer sells parts — it describes the product — so the second door states
 * its own case here, for the people and search engines arriving to shop.
 */
export const metadata: Metadata = {
  title: "Marketplace - DRVN",
  description:
    "Buy used and take-off parts from modified cars. Filter by category, brand, condition and what fits your garage — and see the build each part came off.",
  alternates: { canonical: "/marketplace" },
  openGraph: {
    title: "DRVN Marketplace — used parts off real builds",
    description:
      "Used and take-off parts from modified cars, with the build behind every part.",
    url: "/marketplace",
    type: "website",
  },
};

export default async function MarketplacePage({ searchParams }: { searchParams: Promise<RawMarketplaceParams> }) {
  return <MarketplacePageContent raw={await searchParams} />;
}
