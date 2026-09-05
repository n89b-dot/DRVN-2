"use client";

import { useState } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cx } from "@/lib/format";

import { FormField, fieldDescribedBy } from "./form";
import { Icon } from "./icons";

/**
 * TextField's password sibling: the same `.field`/`.ctl` contract plus the
 * reveal toggle every password box is expected to have. Revealing is a
 * client-side convenience — the value never changes, only the input type —
 * and the toggle is a real button (labelled, focusable, excluded from tab
 * submission order is NOT desirable, so it stays in the tab order).
 *
 * Width behaviour matches TextField: `.ctl`'s 320px max-width moves to the
 * wrapper so `className` width overrides (`max-w-none`) keep working
 * unchanged at the call site.
 */
export function PasswordField({
  id,
  label,
  labelEnd,
  optional,
  hint,
  error,
  ok,
  row,
  className,
  fieldClassName,
  required,
  ...rest
}: {
  id: string;
  label: ReactNode;
  labelEnd?: ReactNode;
  /** Marks the label "— optional" on forms where most fields are required. */
  optional?: boolean;
  row?: boolean;
  /** Layout-only classes for the control (widths) — applied to the wrapper,
   *  exactly where TextField callers expect width overrides to land. */
  className?: string;
  /** Classes for the wrapping field block. */
  fieldClassName?: string;
  hint?: ReactNode;
  error?: ReactNode;
  ok?: ReactNode;
} & Omit<ComponentPropsWithoutRef<"input">, "id" | "type">) {
  const [revealed, setRevealed] = useState(false);

  return (
    <FormField
      id={id}
      label={label}
      labelEnd={labelEnd}
      optional={optional}
      hint={hint}
      error={error}
      ok={ok}
      row={row}
      className={fieldClassName}
    >
      <span className={cx("relative block w-full max-w-[320px]", className)}>
        <input
          id={id}
          type={revealed ? "text" : "password"}
          className="ctl w-full !max-w-none !pr-11"
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldDescribedBy(id, { hint, error, ok })}
          required={required}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          aria-label={revealed ? "Hide password" : "Show password"}
          title={revealed ? "Hide password" : "Show password"}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-ctl p-1.5 text-dim transition-colors hover:text-ink"
        >
          <Icon name={revealed ? "eye-off" : "eye"} className="h-5 w-5" />
        </button>
      </span>
    </FormField>
  );
}
