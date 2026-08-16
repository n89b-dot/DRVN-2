"use client";

import { useState } from "react";

import { cx } from "@/lib/format";

/**
 * Labeled control with a live character counter in the label row ("12 of 160").
 * Only for fields with a real server-enforced limit — a counter on an
 * unlimited field is theater.
 *
 * The control is CONTROLLED on purpose: React 19 auto-resets uncontrolled
 * fields when the enclosing `<form action>` completes (success or error
 * return), which would blank the input while a state-held counter kept the
 * old number. Controlled value keeps input and counter in lockstep — and
 * preserves what the user typed across a server-side validation error.
 *
 * The counter is aria-hidden: the limit is already enforced via maxLength,
 * and a live region updating per keystroke would be noise.
 */
export function CountedField({
  id,
  name,
  label,
  max,
  defaultValue = "",
  placeholder,
  required,
  textarea,
  rows = 4,
  autoComplete,
  autoFocus,
  hint,
  className,
}: {
  id: string;
  name: string;
  label: string;
  max: number;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  textarea?: boolean;
  rows?: number;
  autoComplete?: string;
  autoFocus?: boolean;
  /** Optional `.field__hint` line rendered inside the field block, so callers
   *  don't wrap this component in a second `.field` just to attach one. */
  hint?: string;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue);

  const shared = {
    id,
    name,
    value,
    placeholder,
    required,
    maxLength: max,
    autoComplete,
    autoFocus,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValue(e.target.value),
  };

  return (
    <div className="field !mb-0">
      <span className="field__labelrow">
        <label htmlFor={id} className="microlabel">
          {label}
        </label>
        <span aria-hidden="true" className="field__count">
          {value.length} of {max}
        </span>
      </span>
      {textarea ? (
        <textarea {...shared} rows={rows} className={cx("ctl", className)} />
      ) : (
        <input {...shared} className={cx("ctl max-w-none", className)} />
      )}
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
}
