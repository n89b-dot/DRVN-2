import type { Metadata } from "next";

import { MarketplacePageContent } from "@/features/marketplace/page-content";
import { categoryMetadata } from "@/lib/marketplace/metadata";
import type { RawMarketplaceParams } from "@/lib/marketplace/state";

export async function generateMetadata({ params }: {
  params: Promise<{ category: string; subcategory: string }>;
}): Promise<Metadata> {
  const route = await params;
  return categoryMetadata(route.category, route.subcategory);
}

export default async function SubcategoryPage({ params, searchParams }: {
  params: Promise<{ category: string; subcategory: string }>;
  searchParams: Promise<RawMarketplaceParams>;
}) {
  const route = await params;
  return <MarketplacePageContent raw={await searchParams} categorySlug={route.category} subcategorySlug={route.subcategory} />;
}
