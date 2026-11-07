import type { Metadata } from "next";

import { MarketplacePageContent } from "@/features/marketplace/page-content";
import { MARKETPLACE_DESCRIPTION, MARKETPLACE_SHARE_DESCRIPTION, MARKETPLACE_SHARE_TITLE } from "@/lib/share-copy";
import type { RawMarketplaceParams } from "@/lib/marketplace/state";

/**
 * Marketplace routes keep marketplace wording (F-2). The root description no
 * longer sells parts — it describes the product — so the second door states
 * its own case here, for the people and search engines arriving to shop.
 */
export const metadata: Metadata = {
  title: "Marketplace - DRVN",
  description: MARKETPLACE_DESCRIPTION,
  alternates: { canonical: "/marketplace" },
  openGraph: {
    title: MARKETPLACE_SHARE_TITLE,
    description: MARKETPLACE_SHARE_DESCRIPTION,
    url: "/marketplace",
    type: "website",
  },
};

export default async function MarketplacePage({ searchParams }: { searchParams: Promise<RawMarketplaceParams> }) {
  return <MarketplacePageContent raw={await searchParams} />;
}
