import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cx } from "@/lib/format";

/**
 * The form family — the `.field` / `.ctl` recipes as components, so a page
 * never hand-assembles label + control + hint + error again, and the aria
 * relationships can't be forgotten.
 *
 * Material's text-field anatomy supplies the contract (label, supporting
 * text, error state, prefix, described-by wiring); the rendering is entirely
 * Livesheet: mono microcap labels, 16px mono controls on paper-deep (no iOS
 * zoom), transparent rest border that paints live/ok on state, 10px control
 * radius.
 *
 * Native elements throughout — never div recreations.
 */

type FieldMessages = {
  hint?: ReactNode;
  /** Error text. Presence renders it (role=alert) and paints the control. */
  error?: ReactNode;
  /** Success line, e.g. "Looks good" — only where confirmation means something. */
  ok?: ReactNode;
};

function describedBy(id: string, { hint, error, ok }: FieldMessages) {
  return (
    [error && `${id}-err`, ok && `${id}-ok`, hint && `${id}-hint`]
      .filter(Boolean)
      .join(" ") || undefined
  );
}

/**
 * Generic labelled field wrapper for any control. TextField/TextArea/Select
 * use it internally; reach for it directly only for controls the family
 * doesn't cover, and wire `aria-describedby`/`aria-invalid` on the control
 * yourself via `fieldDescribedBy`.
 */
export function FormField({
  id,
  label,
  labelEnd,
  optional = false,
  hint,
  error,
  ok,
  row = false,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  /** Right-aligned slot in the label row (a counter, an aside). */
  labelEnd?: ReactNode;
  /** Marks the label "— optional" on forms where most fields are required. */
  optional?: boolean;
  row?: boolean;
  className?: string;
  children: ReactNode;
} & FieldMessages) {
  const labelNode = (
    <label htmlFor={id} className="field__label">
      {label}
      {optional && <span> — optional</span>}
    </label>
  );

  return (
    <div
      className={cx(
        "field",
        row && "field--row",
        error ? "is-invalid" : undefined,
        !error && ok ? "is-ok" : undefined,
        className
      )}
    >
      {labelEnd ? (
        <span className="field__labelrow">
          {labelNode}
          {labelEnd}
        </span>
      ) : (
        labelNode
      )}
      {children}
      <span id={`${id}-err`} className="field__err" role="alert">
        {error}
      </span>
      {ok && (
        <span id={`${id}-ok`} className="field__ok">
          {ok}
        </span>
      )}
      {hint && (
        <span id={`${id}-hint`} className="field__hint">
          {hint}
        </span>
      )}
    </div>
  );
}

/** Aria wiring for custom controls rendered inside a bare FormField. */
export const fieldDescribedBy = describedBy;

type SharedFieldProps = {
  id: string;
  label: ReactNode;
  labelEnd?: ReactNode;
  /** Marks the label "— optional" on forms where most fields are required. */
  optional?: boolean;
  row?: boolean;
  /** Layout-only classes for the control itself (widths). */
  className?: string;
  /** Classes for the wrapping field block. */
  fieldClassName?: string;
} & FieldMessages;

export function TextField({
  id,
  label,
  labelEnd,
  optional,
  hint,
  error,
  ok,
  row,
  prefix,
  className,
  fieldClassName,
  required,
  ...rest
}: SharedFieldProps & {
  /** Joined mono prefix ("PN", "$") rendered inside the control plate. */
  prefix?: string;
} & Omit<ComponentPropsWithoutRef<"input">, "id" | "prefix">) {
  const input = (
    <input
      id={id}
      className={cx("ctl", className)}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, { hint, error, ok })}
      required={required}
      {...rest}
    />
  );

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
      {prefix ? (
        <span className="ctl__prefix">
          <span aria-hidden="true">{prefix}</span>
          {input}
        </span>
      ) : (
        input
      )}
    </FormField>
  );
}

export function TextArea({
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
  rows = 4,
  ...rest
}: SharedFieldProps & Omit<ComponentPropsWithoutRef<"textarea">, "id">) {
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
      <textarea
        id={id}
        rows={rows}
        className={cx("ctl", className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { hint, error, ok })}
        required={required}
        {...rest}
      />
    </FormField>
  );
}

/**
 * Native select in the field contract. Stays a real `<select>` — the compact
 * experience (the platform picker) is better than any recreated menu.
 */
export function Select({
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
  children,
  ...rest
}: SharedFieldProps & Omit<ComponentPropsWithoutRef<"select">, "id">) {
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
      <select
        id={id}
        className={cx("ctl", className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { hint, error, ok })}
        required={required}
        {...rest}
      >
        {children}
      </select>
    </FormField>
  );
}

/** Live-accent square checkbox (`.sq`) with its label as one touch target. */
export function Checkbox({
  label,
  hint,
  className,
  ...rest
}: {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
} & ComponentPropsWithoutRef<"input">) {
  return (
    <label className={cx("flex min-h-11 cursor-pointer items-start gap-2.5 py-1", className)}>
      <input type="checkbox" className="sq mt-0.5" {...rest} />
      <span className="min-w-0">
        <span className="block text-body">{label}</span>
        {hint && <span className="field__hint block">{hint}</span>}
      </span>
    </label>
  );
}

/** Radio in the same square-mark language (the stylesheet rounds it). */
export function Radio({
  label,
  className,
  ...rest
}: {
  label: ReactNode;
  className?: string;
} & ComponentPropsWithoutRef<"input">) {
  return (
    <label className={cx("flex min-h-11 cursor-pointer items-center gap-2.5 py-1", className)}>
      <input type="radio" className="sq" {...rest} />
      <span className="text-body">{label}</span>
    </label>
  );
}
