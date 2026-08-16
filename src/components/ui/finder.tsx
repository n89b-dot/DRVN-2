import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "@/lib/format";

/**
 * The search field itself — the `.search` plate (⌕ glyph + native search
 * input). Standalone it sits on `--tile`; inside a Finder the stylesheet
 * recesses it onto `--paper-deep` and lets it flex.
 *
 * Native `<input type="search">` on purpose: 16px mono keeps iOS from
 * zooming, and the platform clear affordance stays.
 */
export function SearchField({
  label,
  name = "q",
  defaultValue,
  placeholder,
  className,
}: {
  /** Accessible name — required; the placeholder is documentation, not a label. */
  label: string;
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={cx("search", className)}>
      <span aria-hidden="true">⌕</span>
      <input
        type="search"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={label}
      />
    </label>
  );
}

/**
 * The search command plate — the `.finder` composition Saved and Messages
 * each hand-rolled: a query line on top (label · field · submit), refinements
 * on their own line beneath, so search and sort read as two operations
 * instead of collapsing into one blob of controls on a phone.
 *
 * Adaptive contract (all in the stylesheet): compact stacks the label,
 * field and submit full-width; medium/expanded run them inline. GET form on
 * purpose — every search is a shareable URL.
 */
export function Finder({
  action,
  searchLabel,
  inputLabel,
  name = "q",
  defaultValue,
  placeholder,
  submitLabel = "Search",
  hidden,
  clearHref,
  refine,
  className,
}: {
  action: string;
  /** Optional mono introduction on the query row ("Search"). */
  searchLabel?: string;
  /** Accessible name for the input itself ("Search saved parts"). */
  inputLabel: string;
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  submitLabel?: string;
  /** Params carried through a search (active tab, chosen sort). */
  hidden?: Record<string, string | undefined>;
  /** Renders a quiet Clear beside the submit while a query is active. */
  clearHref?: string;
  /** The refinement row — FilterLinks, a label, a FinderClear. */
  refine?: ReactNode;
  className?: string;
}) {
  return (
    <form action={action} method="get" className={cx("finder", className)} role="search">
      {Object.entries(hidden ?? {}).map(([key, value]) =>
        value ? <input key={key} type="hidden" name={key} value={value} /> : null
      )}
      <div className="finder__main">
        {searchLabel && (
          <span className="microlabel filters__label w-full sm:w-auto">{searchLabel}</span>
        )}
        <SearchField
          label={inputLabel}
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
        />
        <button type="submit" className="btn w-full sm:w-auto">
          {submitLabel}
        </button>
        {clearHref && (
          /* `.fbtn` is inline-flex with no justify-content, so stretched to
             full width its label would sit left under a centred Search. */
          <Link href={clearHref} className="fbtn w-full justify-center sm:w-auto">
            Clear
          </Link>
        )}
      </div>
      {refine && <div className="finder__refine">{refine}</div>}
    </form>
  );
}

/** Mono introduction for a refinement row inside a Finder. */
export function FinderLabel({ children }: { children: ReactNode }) {
  return <span className="microlabel filters__label w-full sm:w-auto">{children}</span>;
}

/** "Clear search" — quiet, right-aligned on wide rows, a full-width 44px
 *  target on compact. */
export function FinderClear({ href, children = "Clear search" }: { href: string; children?: ReactNode }) {
  return (
    <Link
      href={href}
      className="jumplink inline-flex min-h-11 w-full items-center sm:ml-auto sm:min-h-0 sm:w-auto"
    >
      {children}
    </Link>
  );
}
