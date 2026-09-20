import type { Metadata } from "next";

import { MarketplacePageContent } from "@/features/marketplace/page-content";
import { categoryMetadata } from "@/lib/marketplace/metadata";
import type { RawMarketplaceParams } from "@/lib/marketplace/state";

export async function generateMetadata({ params }: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  return categoryMetadata((await params).category);
}

export default async function CategoryPage({ params, searchParams }: {
  params: Promise<{ category: string }>;
  searchParams: Promise<RawMarketplaceParams>;
}) {
  return <MarketplacePageContent raw={await searchParams} categorySlug={(await params).category} />;
}
