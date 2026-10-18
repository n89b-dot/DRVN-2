import Link from "next/link";

import { MetricCard, PageHead, SheetTabs, Pagination } from "@/components/ui";
import {
  getIdentityReviews,
  getProductCoverage,
  IDENTITY_REVIEW_KINDS,
  IDENTITY_REVIEWS_PAGE_SIZE,
  type IdentityReviewKind,
  type IdentityReviewsResult,
} from "@/lib/admin/product-identity";
import { cx } from "@/lib/format";

import { ConsoleEmpty } from "../_components/console-empty";
import { IdentityReviewList } from "./review-list";

export const dynamic = "force-dynamic";

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%");

function ReviewsPanel({
  result,
  empty,
  pagerHref,
  older,
}: {
  result: IdentityReviewsResult;
  empty: { title: string; body: string };
  pagerHref: (page: number) => string;
  older: boolean;
}) {
  if (!result.rows.length) return <ConsoleEmpty className="mt-4" mark="—" title={empty.title} body={empty.body} />;
  return (
    <>
      {result.total > result.rows.length && (
        <p className="mt-3 order__meta !mb-0">
          Showing {result.page * IDENTITY_REVIEWS_PAGE_SIZE + 1}–{result.page * IDENTITY_REVIEWS_PAGE_SIZE + result.rows.length} of{" "}
          {result.total}
        </p>
      )}
      <IdentityReviewList rows={result.rows} />
      <Pagination
        page={result.page + 1}
        hasMore={result.hasMore}
        hrefFor={(target) => pagerHref(target - 1)}
        prevLabel={older ? "← Newer" : "← Back"}
        nextLabel={older ? "Older →" : "More →"}
      />
    </>
  );
}

/**
 * Product identity the graph couldn't decide (B1). grow_products() makes a
 * product for every brand + part number members write and merges only on
 * the same brand and number or a brand-scoped "same product" link; anything
 * else that looks like one part lands here. Coverage is from its latest run.
 */
export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; kind?: string; page?: string }>;
}) {
  const { view, kind, page: pageParam } = await searchParams;
  const page = Math.max(0, Number.parseInt(pageParam ?? "0", 10) || 0);
  const activeKind = IDENTITY_REVIEW_KINDS.some((k) => k.kind === kind) ? (kind as IdentityReviewKind) : undefined;
  const [coverage, open, closed] = await Promise.all([
    getProductCoverage(),
    getIdentityReviews("open", { kind: activeKind, page: view === "closed" ? 0 : page }),
    getIdentityReviews("closed", { kind: activeKind, page: view === "closed" ? page : 0 }),
  ]);

  const pagerHref = (tab: "open" | "closed") => (target: number) =>
    `/admin/products?${new URLSearchParams({
      ...(activeKind ? { kind: activeKind } : {}),
      ...(tab === "closed" ? { view: "closed" } : {}),
      ...(target > 0 ? { page: String(target) } : {}),
    })}`;
  const kindHref = (k?: string) =>
    `/admin/products?${new URLSearchParams({ ...(k ? { kind: k } : {}), ...(view === "closed" ? { view } : {}) })}`;
  const explain = activeKind ? IDENTITY_REVIEW_KINDS.find((k) => k.kind === activeKind)?.explain : undefined;

  return (
    <>
      <PageHead
        title="Products"
        sub="Part identity the graph couldn't decide on its own. Only the same brand and number, a brand-scoped “same product” link or a decision here makes two records one product."
      />

      <section aria-label="Product coverage" className="deck deck--kpi mb-6">
        <MetricCard
          label="Listings with a product"
          value={coverage ? pct(coverage.listings.withProduct, coverage.listings.withNumber) : "0%"}
          blank={!coverage || coverage.listings.withNumber === 0}
        >
          <p className="order__meta">
            {coverage
              ? `${coverage.listings.withProduct} of ${coverage.listings.withNumber} with a part number · ${coverage.listings.withNumber - coverage.listings.withBrandAndNumber} without a brand`
              : "Not measured yet"}
          </p>
        </MetricCard>
        <MetricCard
          label="Build lines with a product"
          value={coverage ? pct(coverage.modItems.withProduct, coverage.modItems.withNumber) : "0%"}
          blank={!coverage || coverage.modItems.withNumber === 0}
        >
          <p className="order__meta">
            {coverage
              ? `${coverage.modItems.withProduct} of ${coverage.modItems.withNumber} with a part number · ${coverage.modItems.withNumber - coverage.modItems.withBrandAndNumber} without a brand`
              : "Not measured yet"}
          </p>
        </MetricCard>
        <MetricCard label="Products" value={String(coverage?.products.active ?? 0)} blank={!coverage?.products.active}>
          <p className="order__meta">
            {coverage
              ? `${coverage.productsOnListingsAndBuilds} both listed and on a build · ${coverage.products.merged} merged · measured ${new Date(coverage.ranAt).toLocaleString()}`
              : "Grows hourly from listings and builds"}
          </p>
        </MetricCard>
      </section>

      <div className="filters mb-2" aria-label="Filter by kind">
        <Link href={kindHref()} className={cx("fbtn", !activeKind && "is-on")}>
          All
        </Link>
        {IDENTITY_REVIEW_KINDS.map((k) => (
          <Link key={k.kind} href={kindHref(k.kind)} className={cx("fbtn", activeKind === k.kind && "is-on")}>
            {k.label}
          </Link>
        ))}
      </div>
      {explain && <p className="order__meta mb-4">{explain}</p>}

      <SheetTabs
        label="Identity reviews"
        initialTab={view === "closed" ? "closed" : "open"}
        tabs={[
          {
            key: "open",
            label: "Open",
            count: open.total,
            live: open.total > 0,
            panel: (
              <ReviewsPanel
                result={open}
                older={false}
                pagerHref={pagerHref("open")}
                empty={{ title: "Nothing to decide", body: "Ambiguous part identity lands here after each hourly run." }}
              />
            ),
          },
          {
            key: "closed",
            label: "Decided",
            panel: (
              <ReviewsPanel
                result={closed}
                older
                pagerHref={pagerHref("closed")}
                empty={{ title: "No decisions yet", body: "Reviews move here once merged, kept separate or dismissed." }}
              />
            ),
          },
        ]}
      />
    </>
  );
}
