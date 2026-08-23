"use client";

import Link from "next/link";
import { useState } from "react";

import { BottomSheet, CategoryIcon } from "@/components/ui";
import { cx } from "@/lib/format";
import { CATEGORIES } from "@/lib/marketplace/taxonomy";

/**
 * The compact-width category browser: one "Browse" control in the finder's
 * toolbar (beside Refine and Sort) that opens the whole taxonomy as a sheet
 * of ruled rows — every category one tap away, the current one inked, its
 * subcategories unfolded beneath it.
 *
 * Replaces the sideways "Browse by category" chip carousel, where the last
 * categories were only found by scrolling past the first. Rendered only
 * under 640px by its parent; ≥640px the CategoryNav tile grid takes over.
 */
export function CategorySheet({
  currentCategory,
  currentSubcategory,
}: {
  currentCategory?: string | null;
  currentSubcategory?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const current = CATEGORIES.find((c) => c.slug === currentCategory);
  const label = current
    ? (current.subcategories.find((s) => s.slug === currentSubcategory)?.label ?? current.label)
    : "All parts";

  return (
    <>
      <button
        type="button"
        className={cx("fbtn", current && "is-on")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Browse categories — currently ${label}`}
        onClick={() => setOpen(true)}
      >
        Browse
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} label="Browse by category">
        <div className="catsheet__head">
          <span className="microlabel microlabel--ink">Browse by category</span>
          <span className="microlabel">{CATEGORIES.length} categories</span>
        </div>
        <nav className="catlist" aria-label="Categories">
          <Link
            href="/marketplace"
            className={cx("catrow", !current && "is-here")}
            aria-current={!current ? "page" : undefined}
          >
            <span className="cattile__ico" aria-hidden="true">
              ∀
            </span>
            <span className="min-w-0">
              <span className="cattile__label">All parts</span>
              <span className="cattile__hint">Everything listed right now</span>
            </span>
            <span className="catrow__go" aria-hidden="true">
              →
            </span>
          </Link>
          {CATEGORIES.map((c) => {
            const here = c.slug === current?.slug;
            return (
              <div key={c.slug}>
                <Link
                  href={`/marketplace/${c.slug}`}
                  className={cx("catrow", here && !currentSubcategory && "is-here")}
                  aria-current={here && !currentSubcategory ? "page" : undefined}
                >
                  <span className="cattile__ico" aria-hidden="true">
                    <CategoryIcon name={c.icon} />
                  </span>
                  <span className="min-w-0">
                    <span className="cattile__label">{c.label}</span>
                    <span className="cattile__hint">
                      {c.subcategories.length} subcategories
                    </span>
                  </span>
                  <span className="catrow__go" aria-hidden="true">
                    →
                  </span>
                </Link>
                {here && (
                  <div className="catlist catlist--sub">
                    {c.subcategories.map((sub) => {
                      const subHere = sub.slug === currentSubcategory;
                      return (
                        <Link
                          key={sub.slug}
                          href={`/marketplace/${c.slug}/${sub.slug}`}
                          className={cx("catrow catrow--sub", subHere && "is-here")}
                          aria-current={subHere ? "page" : undefined}
                        >
                          <span className="min-w-0">
                            <span className="cattile__label">{sub.label}</span>
                          </span>
                          <span className="catrow__go" aria-hidden="true">
                            →
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </BottomSheet>
    </>
  );
}
