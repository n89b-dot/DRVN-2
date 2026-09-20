import Link from "next/link";

import { CategoryIcon } from "@/components/ui";
import { categoryHref, type ListingFilters } from "@/lib/marketplace/state";
import { cx } from "@/lib/format";
import { CATEGORIES, type Category } from "@/lib/marketplace/taxonomy";

import { CategorySheet } from "./category-sheet";

/**
 * Category navigation — destinations, not refinements.
 *
 * The marketplace has real `/marketplace/[category]/[subcategory]` routes;
 * this is their entry point, kept visually apart from the refine/sort
 * controls so "what kind of part" never reads as one more filter chip:
 *
 *   /marketplace                → tile grid: All parts + the six categories
 *   /marketplace/[category]     → tile grid: All <category> + its subcategories
 *   filtered or leaf results   → persistent, expandable category tree
 *
 * Tiles narrow as you go down (USP's category-landing pattern, adapted) and
 * filtered results use the tree. On compact widths navigation
 * lives in the browse sheet beside Refine and Sort (see CategorySheet), so
 * nothing is discovered by scrolling to the end of a carousel. The taxonomy
 * file stays the only source of truth.
 */

/** "Coilovers & Springs · Big Brake Kits · …" — the tile's one-line hint. */
function hintFor(category: Category): string {
  return category.subcategories
    .slice(0, 3)
    .map((s) => s.label)
    .join(" · ");
}

export function CategoryNav({
  category,
  subcategory,
  filters = {},
  compact = false,
  counts,
}: {
  /** The category route being viewed, if any. */
  category?: Category | null;
  /** The subcategory slug being viewed, if any (leaf). */
  subcategory?: string | null;
  filters?: ListingFilters;
  compact?: boolean;
  counts?: Record<string, number>;
}) {
  if (compact) {
    return (
      <nav className="marketplace-categories hidden sm:block" aria-label="Browse by category">
        <details>
          <summary>Browse categories <span>{category?.subcategories.find(s => s.slug === subcategory)?.label ?? category?.label ?? "All parts"}</span></summary>
          <div className="marketplace-category-tree">
            <Link href={categoryHref(filters)} aria-current={!category ? "page" : undefined}>All parts</Link>
            {CATEGORIES.map(c => (
              <div key={c.slug}>
                <Link href={categoryHref(filters, c.slug)} aria-current={c.slug === category?.slug && !subcategory ? "page" : undefined}>{c.label}</Link>
                <ul>
                  {c.subcategories.map(sub => <li key={sub.slug}><Link href={categoryHref(filters, c.slug, sub.slug)} aria-current={c.slug === category?.slug && sub.slug === subcategory ? "page" : undefined}>{sub.label}</Link></li>)}
                </ul>
              </div>
            ))}
          </div>
        </details>
      </nav>
    );
  }

  if (category) {
    return (
      <nav className="catnav hidden sm:block" aria-label={`Browse ${category.label}`}>
        <div className="catnav__head">
          <span className="microlabel">Browse {category.label}</span>
          <CategorySheet currentCategory={category?.slug} currentSubcategory={subcategory} filters={filters} />
        </div>
        <div className="catgrid">
          <Link
            href={categoryHref(filters, category.slug)}
            className="cattile is-here"
            aria-current="page"
          >
            <span className="cattile__ico" aria-hidden="true">
              <CategoryIcon name={category.icon} />
            </span>
            <span className="min-w-0">
              <span className="cattile__label">All {category.label}</span>
              <span className="cattile__hint">
                {counts ? `${counts[category.slug] ?? 0} parts available` : `${category.subcategories.length} part types`}
              </span>
            </span>
          </Link>
          {category.subcategories.filter(sub => !counts || (counts[`${category.slug}/${sub.slug}`] ?? 0) > 0).map((sub) => (
            <Link
              key={sub.slug}
              href={categoryHref(filters, category.slug, sub.slug)}
              className="cattile cattile--sub"
            >
              <span className="min-w-0">
                <span className="cattile__label">{sub.label}</span>
              </span>
            </Link>
          ))}
        </div>
      </nav>
    );
  }

  return (
    <nav className="catnav hidden sm:block" aria-label="Browse by category">
      <div className="catnav__head">
        <span className="microlabel">Browse available categories</span>
        <CategorySheet filters={filters} />
      </div>
      <div className="catgrid">
        <Link href={categoryHref(filters)} className="cattile cattile--all is-here" aria-current="page">
          <span className="cattile__ico" aria-hidden="true">
            ∀
          </span>
          <span className="min-w-0">
            <span className="cattile__label">All parts</span>
            <span className="cattile__hint">{counts ? `${counts.all ?? 0} parts available` : "Everything listed right now"}</span>
          </span>
        </Link>
        {CATEGORIES.filter(c => !counts || (counts[c.slug] ?? 0) > 0).map((c) => (
          <Link key={c.slug} href={categoryHref(filters, c.slug)} className={cx("cattile")}>
            <span className="cattile__ico" aria-hidden="true">
              <CategoryIcon name={c.icon} />
            </span>
            <span className="min-w-0">
              <span className="cattile__label">{c.label}</span>
              <span className="cattile__hint">{counts ? `${counts[c.slug] ?? 0} parts available` : hintFor(c)}</span>
            </span>
          </Link>
        ))}
      </div>
    </nav>
  );
}

export { CategorySheet };
