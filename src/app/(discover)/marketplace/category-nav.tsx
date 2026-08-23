import Link from "next/link";

import { CategoryIcon, FilterGroup, FilterLink } from "@/components/ui";
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
 *   /marketplace/[cat]/[sub]    → the sibling subcategories as a quiet row
 *
 * Tiles narrow as you go down (USP's category-landing pattern, adapted) and
 * the leaf drops them. On compact widths the grid hides and the same set
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
}: {
  /** The category route being viewed, if any. */
  category?: Category | null;
  /** The subcategory slug being viewed, if any (leaf). */
  subcategory?: string | null;
}) {
  // Leaf: siblings only, as a quiet secondary row — the page head already
  // names where we are.
  if (category && subcategory) {
    return (
      <FilterGroup label="Narrow it down" ariaLabel="Subcategories" sub scroll stack>
        <FilterLink href={`/marketplace/${category.slug}`}>All {category.label}</FilterLink>
        {category.subcategories.map((sub) => (
          <FilterLink
            key={sub.slug}
            href={`/marketplace/${category.slug}/${sub.slug}`}
            selected={sub.slug === subcategory}
          >
            {sub.label}
          </FilterLink>
        ))}
      </FilterGroup>
    );
  }

  if (category) {
    return (
      <nav className="catnav hidden sm:block" aria-label={`Browse ${category.label}`}>
        <div className="catnav__head">
          <span className="microlabel">Browse {category.label}</span>
          <Link href="/marketplace" className="jumplink">
            ← All categories
          </Link>
        </div>
        <div className="catgrid">
          <Link
            href={`/marketplace/${category.slug}`}
            className="cattile is-here"
            aria-current="page"
          >
            <span className="cattile__ico" aria-hidden="true">
              <CategoryIcon name={category.icon} />
            </span>
            <span className="min-w-0">
              <span className="cattile__label">All {category.label}</span>
              <span className="cattile__hint">
                {category.subcategories.length} subcategories
              </span>
            </span>
          </Link>
          {category.subcategories.map((sub) => (
            <Link
              key={sub.slug}
              href={`/marketplace/${category.slug}/${sub.slug}`}
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
        <span className="microlabel">Browse by category</span>
      </div>
      <div className="catgrid">
        <Link href="/marketplace" className="cattile cattile--all is-here" aria-current="page">
          <span className="cattile__ico" aria-hidden="true">
            ∀
          </span>
          <span className="min-w-0">
            <span className="cattile__label">All parts</span>
            <span className="cattile__hint">Everything listed right now</span>
          </span>
        </Link>
        {CATEGORIES.map((c) => (
          <Link key={c.slug} href={`/marketplace/${c.slug}`} className={cx("cattile")}>
            <span className="cattile__ico" aria-hidden="true">
              <CategoryIcon name={c.icon} />
            </span>
            <span className="min-w-0">
              <span className="cattile__label">{c.label}</span>
              <span className="cattile__hint">{hintFor(c)}</span>
            </span>
          </Link>
        ))}
      </div>
    </nav>
  );
}

export { CategorySheet };
