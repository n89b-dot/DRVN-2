import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "@/lib/format";

import { Icon } from "./icons";

/**
 * THE search field — the one `.search` band every search on the platform
 * renders (Explore via SuggestingSearchField, Marketplace, Messages, Saved,
 * the console queues): search icon + native search input on a raised
 * tile. No submit button anywhere — Enter submits, as every search does.
 *
 * Native `<input type="search">` on purpose: 16px mono on compact keeps iOS
 * from zooming, and the platform clear affordance stays.
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
      <Icon name="search" className="h-4 w-4 shrink-0" />
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
 * The search instrument — the `.finder` composition Saved and Messages
 * each hand-rolled: the query line (the SearchField, owning the row, with
 * an optional Clear beside it), refinements on their own line beneath, so
 * search and sort read as two operations instead of collapsing into one
 * blob of controls on a phone. Same row, same field as Explore and the
 * Marketplace — one look for search across the platform.
 *
 * GET form on purpose — every search is a shareable URL. Enter submits;
 * there is no Search button (one text field, so implicit submission holds).
 */
export function Finder({
  action,
  inputLabel,
  name = "q",
  defaultValue,
  placeholder = "Search…",
  hidden,
  clearHref,
  refine,
  className,
}: {
  action: string;
  /** Accessible name for the input itself ("Search saved parts"). */
  inputLabel: string;
  name?: string;
  defaultValue?: string;
  placeholder?: string;
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
        <SearchField
          label={inputLabel}
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
        />
        {clearHref && (
          <Link href={clearHref} className="fbtn justify-center">
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

/** "Clear search" — quiet, right-aligned on wide rows, a full-width 40px
 *  target on compact. */
export function FinderClear({ href, children = "Clear search" }: { href: string; children?: ReactNode }) {
  return (
    <Link
      href={href}
      className="jumplink inline-flex min-h-10 w-full items-center sm:ml-auto sm:min-h-0 sm:w-auto"
    >
      {children}
    </Link>
  );
}
