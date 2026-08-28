"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { cx } from "@/lib/format";

import { FormField, fieldDescribedBy } from "./form";

/**
 * ComboField — a searchable single-select on the `.field`/`.ctl` recipes
 * (ARIA 1.2 combobox + listbox). For choosing one option from a ranked list
 * too long for a Select: vehicle makes, models, categories. Options keep the
 * order they were given (rank first, then the filter narrows), `keywords`
 * lets an option match text it doesn't display ("Rabbit" → Golf), and the
 * optional `footer` renders a persistent escape hatch ("Can't find it?…") at
 * the end of the list. Strict: the value is always a real option or null —
 * free text is the caller's fallback flow, not this control's job.
 */

export type ComboOption = {
  id: string | number;
  label: string;
  /** Extra text this option should match ("Rabbit" for Golf). Never shown. */
  keywords?: string[];
  /** Dim supporting text after the label (a year range, a country). */
  note?: string;
};

const MAX_VISIBLE = 60;

export function ComboField({
  id,
  label,
  options,
  value,
  onChange,
  onQueryChange,
  placeholder,
  disabled = false,
  loading = false,
  optional,
  hint,
  error,
  emptyText = "No matches.",
  footer,
  className,
}: {
  id: string;
  label: ReactNode;
  /** Ranked list — the given order is the display order within matches. */
  options: ComboOption[];
  /** The selected option's id, or null. */
  value: string | number | null;
  onChange: (option: ComboOption | null) => void;
  /** Observe the raw filter text (for "no match → manual entry" affordances). */
  onQueryChange?: (query: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Renders a quiet "Loading…" row while options are being fetched. */
  loading?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  emptyText?: string;
  /** Persistent last row of the popover — an escape hatch, not an option. */
  footer?: ReactNode;
  className?: string;
}) {
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Committing refocuses the input; that programmatic focus must not reopen
  // the popover the commit just closed.
  const suppressOpenRef = useRef(false);

  const selected = useMemo(
    () => options.find((option) => option.id === value) ?? null,
    [options, value],
  );

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options.slice(0, MAX_VISIBLE);
    const scored: { option: ComboOption; score: number }[] = [];
    for (const option of options) {
      const label = option.label.toLowerCase();
      let score: number | null = null;
      if (label.startsWith(needle)) score = 0;
      else if (label.includes(needle)) score = 1;
      else if (option.keywords?.some((keyword) => keyword.toLowerCase().includes(needle)))
        score = 2;
      if (score !== null) scored.push({ option, score });
    }
    // Stable within a score band, so the given ranking survives filtering.
    return scored
      .sort((a, b) => a.score - b.score)
      .slice(0, MAX_VISIBLE)
      .map((entry) => entry.option);
  }, [options, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  // Close on outside pointerdown — blur alone misfires when clicking options.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const commit = (option: ComboOption) => {
    onChange(option);
    setQuery("");
    onQueryChange?.("");
    setOpen(false);
    suppressOpenRef.current = true;
    inputRef.current?.focus();
  };

  const clearSelection = () => {
    if (selected) onChange(null);
  };

  const displayValue = open ? query : (selected?.label ?? query);
  const activeOption = matches[activeIndex];

  return (
    <FormField id={id} label={label} optional={optional} hint={hint} error={error}>
      <div className="combo" ref={rootRef}>
        <input
          ref={inputRef}
          id={id}
          className={cx("ctl", className)}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeOption ? `${listboxId}-${activeOption.id}` : undefined
          }
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldDescribedBy(id, { hint, error })}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          disabled={disabled}
          value={displayValue}
          onFocus={() => {
            if (suppressOpenRef.current) {
              suppressOpenRef.current = false;
              return;
            }
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            onQueryChange?.(next);
            clearSelection();
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => Math.min(index + 1, matches.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter") {
              if (open && activeOption) {
                event.preventDefault();
                commit(activeOption);
              }
            } else if (event.key === "Escape") {
              if (open) {
                event.preventDefault();
                setOpen(false);
              }
            } else if (event.key === "Tab") {
              setOpen(false);
            }
          }}
        />
        {open && (
          <div className="combo__pop">
            <ul id={listboxId} role="listbox" aria-label={typeof label === "string" ? label : undefined} className="combo__list">
              {loading ? (
                <li className="combo__note" role="presentation">
                  Loading…
                </li>
              ) : matches.length === 0 ? (
                <li className="combo__note" role="presentation">
                  {emptyText}
                </li>
              ) : (
                matches.map((option, index) => (
                  <li
                    key={option.id}
                    id={`${listboxId}-${option.id}`}
                    role="option"
                    aria-selected={option.id === value}
                    className={cx(
                      "combo__opt",
                      index === activeIndex && "is-active",
                      option.id === value && "is-selected",
                    )}
                    onPointerDown={(event) => {
                      // Before the input blurs, so the click always lands.
                      event.preventDefault();
                      commit(option);
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span>{option.label}</span>
                    {option.note ? <span className="combo__optnote">{option.note}</span> : null}
                  </li>
                ))
              )}
            </ul>
            {footer ? <div className="combo__foot">{footer}</div> : null}
          </div>
        )}
      </div>
    </FormField>
  );
}
