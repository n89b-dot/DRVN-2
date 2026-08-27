import type { ReactNode } from "react";

import { cx } from "@/lib/format";

/**
 * Numbered form section — a `.tile` with a mono step numeral (01, 02…) and a
 * heading/hint pair, fields stacked below. Extracted from the Sell form,
 * where every long editing workflow's section head was born.
 */
export function FormSection({
  step,
  title,
  hint,
  className,
  children,
}: {
  /** Zero-padded structural numeral. Omit for unnumbered sections. */
  step?: number;
  title: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cx("tile", className)}>
      <div className="flex items-baseline gap-3">
        {/* Step numerals are structure, not live state — signal red is
            reserved for things happening now. */}
        {step !== undefined && (
          <span className="font-mono text-xs tracking-[0.1em] text-dim">
            {String(step).padStart(2, "0")}
          </span>
        )}
        <div>
          <h2 className="text-body font-semibold tracking-[-0.01em]">{title}</h2>
          {hint && <p className="field__hint mt-0.5">{hint}</p>}
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-3">{children}</div>
    </section>
  );
}

export type ValidationEntry = {
  /** Anchor id of the offending field (no leading #). */
  anchor: string;
  /** Human label for the jump link. */
  label: ReactNode;
  message: ReactNode;
};

/**
 * Submit-blocking error summary — an assertive tile listing every failed
 * field as a jump link. Render it above the form's first section; the field
 * itself still carries its own inline error.
 */
export function ValidationSummary({
  entries,
  title = "Fix these before submitting:",
  className,
}: {
  entries: ValidationEntry[];
  title?: ReactNode;
  className?: string;
}) {
  if (entries.length === 0) return null;
  return (
    <div role="alert" aria-live="assertive" className={cx("tile !mb-0 text-live", className)}>
      <p className="font-semibold">{title}</p>
      <ul className="mt-1 list-disc pl-5 text-micro">
        {entries.map((entry) => (
          <li key={entry.anchor}>
            <a href={`#${entry.anchor}`} className="jumplink underline">
              {entry.label}
            </a>
            {" — "}
            {entry.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
