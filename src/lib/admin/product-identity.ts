import "server-only";

import { reportError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The product identity review list (B1, 20261020120000). grow_products()
 * files what it can't decide — one number under several brands, a known
 * number with no brand, an unscoped "same product" link, a listing whose
 * "also known as" number belongs to another product — and an admin decides
 * here. Products and their membership are internal tables, read with the
 * service role; decisions go through resolve_product_identity_review, which
 * checks the admin and step-up itself.
 */

export const IDENTITY_REVIEWS_PAGE_SIZE = 25;

export type IdentityReviewKind =
  | "number_across_brands"
  | "brandless_number"
  | "unscoped_same_product"
  | "listing_alternate";

export type IdentityReviewStatus = "open" | "merged" | "kept_separate" | "dismissed" | "obsolete";

export const IDENTITY_REVIEW_KINDS: { kind: IdentityReviewKind; label: string; explain: string }[] = [
  {
    kind: "number_across_brands",
    label: "One number, several brands",
    explain: "Different parts that share a number, or one brand spelled two ways.",
  },
  {
    kind: "brandless_number",
    label: "No brand",
    explain: "A listing or build line with a number we know, but no brand. It can't join a product until it has one.",
  },
  {
    kind: "unscoped_same_product",
    label: "Link without brands",
    explain: "A “same product” link that doesn’t say whose numbers they are.",
  },
  {
    kind: "listing_alternate",
    label: "Also-known-as clash",
    explain: "A listing’s own alternate number belongs to another product of the same brand.",
  },
];

export type IdentityReviewProduct = { id: string; brand: string; name: string | null; numbers: string[] };

export type IdentityReviewRow = {
  id: string;
  kind: IdentityReviewKind;
  number: string | null;
  products: IdentityReviewProduct[];
  /** The listing or build line the review is about, when it's about one. */
  record: { label: string; href: string | null } | null;
  detail: Record<string, unknown>;
  status: IdentityReviewStatus;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type IdentityReviewsResult = { rows: IdentityReviewRow[]; total: number; page: number; hasMore: boolean };

/** The latest full grow_products run: the coverage it reached. */
export type ProductCoverage = {
  ranAt: string;
  listings: { withNumber: number; withBrandAndNumber: number; eligible: number; withProduct: number };
  modItems: { withNumber: number; withBrandAndNumber: number; eligible: number; withProduct: number };
  products: { active: number; merged: number };
  productsOnListingsAndBuilds: number;
};

type Json = Record<string, unknown>;
const num = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0) || 0);
const obj = (value: unknown): Json => (value && typeof value === "object" ? (value as Json) : {});

export async function getProductCoverage(): Promise<ProductCoverage | null> {
  const { data, error } = await createAdminClient()
    .from("product_grow_runs")
    .select("ran_at, result")
    // Hourly runs only look at what changed; full runs (nightly) measure.
    .eq("result->>full", "true")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    reportError("[admin] product coverage read failed", error);
    return null;
  }
  if (!data) return null;
  const coverage = obj(obj(data.result).coverage);
  const side = (value: unknown) => {
    const s = obj(value);
    return {
      withNumber: num(s.with_number),
      withBrandAndNumber: num(s.with_brand_and_number),
      eligible: num(s.eligible),
      withProduct: num(s.with_product),
    };
  };
  const products = obj(coverage.products);
  return {
    ranAt: data.ran_at,
    listings: side(coverage.listings),
    modItems: side(coverage.mod_items),
    products: { active: num(products.active), merged: num(products.merged) },
    productsOnListingsAndBuilds: num(coverage.products_on_listings_and_builds),
  };
}

export async function getIdentityReviews(
  scope: "open" | "closed",
  opts: { kind?: IdentityReviewKind; page?: number } = {}
): Promise<IdentityReviewsResult> {
  const a = createAdminClient();
  const page = Math.max(0, opts.page ?? 0);
  let builder = a
    .from("product_identity_reviews")
    .select("id, kind, number_compact, product_ids, listing_id, mod_item_id, detail, status, resolution_note, created_at, resolved_at", {
      count: "exact",
    })
    .order(scope === "open" ? "created_at" : "resolved_at", { ascending: scope === "open" })
    .range(page * IDENTITY_REVIEWS_PAGE_SIZE, page * IDENTITY_REVIEWS_PAGE_SIZE + IDENTITY_REVIEWS_PAGE_SIZE - 1);
  builder = scope === "open" ? builder.eq("status", "open") : builder.neq("status", "open");
  if (opts.kind) builder = builder.eq("kind", opts.kind);
  const { data, count, error } = await builder;
  if (error) {
    reportError("[admin] identity reviews read failed", error);
    return { rows: [], total: 0, page, hasMore: false };
  }
  const reviews = data ?? [];

  const productIds = [...new Set(reviews.flatMap((r) => r.product_ids ?? []))];
  const listingIds = reviews.map((r) => r.listing_id).filter((id): id is string => Boolean(id));
  const modIds = reviews.map((r) => r.mod_item_id).filter((id): id is string => Boolean(id));
  const [products, numbers, listings, mods] = await Promise.all([
    productIds.length
      ? a.from("products").select("id, brand, name, merged_into").in("id", productIds)
      : Promise.resolve({ data: [] as { id: string; brand: string; name: string | null; merged_into: string | null }[] }),
    productIds.length
      ? a.from("product_part_numbers").select("product_id, number, number_compact").in("product_id", productIds)
      : Promise.resolve({ data: [] as { product_id: string; number: string | null; number_compact: string }[] }),
    listingIds.length
      ? a.from("listings").select("id, title").in("id", listingIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    modIds.length
      ? a.from("mod_items").select("id, product, cars!inner(name, owner_id)").in("id", modIds)
      : Promise.resolve({ data: [] }),
  ]);
  const productById = new Map((products.data ?? []).map((p) => [p.id, p]));
  const numbersByProduct = new Map<string, string[]>();
  for (const n of numbers.data ?? []) {
    const list = numbersByProduct.get(n.product_id) ?? [];
    list.push(n.number ?? n.number_compact);
    numbersByProduct.set(n.product_id, list);
  }
  const listingTitle = new Map((listings.data ?? []).map((l) => [l.id, l.title]));
  const modById = new Map(
    ((mods.data ?? []) as unknown as { id: string; product: string | null; cars: { name: string; owner_id: string } }[]).map(
      (m) => [m.id, m]
    )
  );

  const rows: IdentityReviewRow[] = reviews.map((r) => {
    let record: IdentityReviewRow["record"] = null;
    if (r.listing_id) {
      const title = listingTitle.get(r.listing_id) ?? "Listing (deleted)";
      record = { label: `Listing: ${title}`, href: `/admin/listings?q=${encodeURIComponent(title)}` };
    } else if (r.mod_item_id) {
      const mod = modById.get(r.mod_item_id);
      record = mod
        ? { label: `Build line: ${mod.product ?? "part"} on ${mod.cars.name}`, href: `/admin/users/${mod.cars.owner_id}` }
        : { label: "Build line (deleted)", href: null };
    }
    return {
      id: r.id,
      kind: r.kind as IdentityReviewKind,
      number: r.number_compact,
      products: (r.product_ids ?? []).flatMap((id) => {
        const p = productById.get(id);
        return p ? [{ id: p.id, brand: p.brand, name: p.name, numbers: numbersByProduct.get(p.id) ?? [] }] : [];
      }),
      record,
      detail: obj(r.detail),
      status: r.status as IdentityReviewStatus,
      resolutionNote: r.resolution_note,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
    };
  });
  const total = count ?? rows.length;
  return { rows, total, page, hasMore: (page + 1) * IDENTITY_REVIEWS_PAGE_SIZE < total };
}

/** Open reviews, for the console nav badge. Null when the count failed. */
export async function countOpenIdentityReviews(): Promise<number | null> {
  const { count, error } = await createAdminClient()
    .from("product_identity_reviews")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  if (error || count == null) {
    reportError("[admin] nav count identity reviews failed", error ?? { message: "count missing" });
    return null;
  }
  return count;
}
