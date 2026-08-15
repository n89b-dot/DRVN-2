import Link from "next/link";

/**
 * Console empty state — the `.undrawn` dashed plate the rest of the product
 * uses, sized for a ledger section. Admin empties were previously a bare
 * tile + sentence, breaking the "empty keeps the geometry of full and names
 * the action that fills it" rule. `actionHref` is for filter-clearing or
 * creation; all-clear queue empties (a healthy ops console) pass none.
 */
export function ConsoleEmpty({
  mark = "⌕",
  title,
  body,
  actionHref,
  actionLabel,
  className = "",
}: {
  mark?: string;
  title: string;
  body?: string;
  actionHref?: string;
  actionLabel?: string;
  className?: string;
}) {
  return (
    <div className={`undrawn ${className}`}>
      <span className="undrawn__mark" aria-hidden="true">
        {mark}
      </span>
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {actionHref && actionLabel && (
        <Link href={actionHref} className="btn btn--ghost">
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
