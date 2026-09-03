"use client";

import { useEffect, useRef, useState } from "react";

import { cx } from "@/lib/format";

/**
 * One refinement behind one chip — the finder's per-filter popover.
 *
 * The chip (`.fbtn`) names the dimension while it's idle and wears the
 * applied value inked (`is-on`) once one is set: "Vehicle ⌄" becomes
 * "BMW M4 ⌄". Opening it drops a small anchored panel with just that
 * dimension's fields and an Apply submit — never a modal, so the results
 * stay visible while refining (the Etsy/Care.com filter-row idiom).
 *
 * The panel's children stay mounted while closed (`hidden`, not unmounted),
 * so inside a GET form every field still submits with the search — the URL
 * stays the contract. Closes on outside press and Escape.
 */
export function FilterPopover({
  label,
  valueLabel,
  align,
  children,
}: {
  /** The dimension's name — the chip's idle text ("Vehicle", "Price"). */
  label: string;
  /** The applied value ("BMW M4", "$100–$500") — inks the chip and replaces
   *  the label. Null/undefined means nothing applied. */
  valueLabel?: string | null;
  /** "end" right-aligns the panel to the chip — for chips near the row's
   *  right edge, where a left-anchored panel would overflow the viewport. */
  align?: "end";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Compact: the panel is position:fixed (its row scrolls horizontally, and
  // a scroll container would clip an absolute panel), so it tracks the
  // trigger's live bottom edge — before the row sticks, while it sticks,
  // and through resizes. Wider widths clear the inline top and let the CSS
  // anchor it.
  useEffect(() => {
    if (!open) return;
    const compact = window.matchMedia("(max-width: 639.98px)");
    const place = () => {
      const panel = panelRef.current;
      const trigger = triggerRef.current;
      if (!panel || !trigger) return;
      panel.style.top = compact.matches
        ? `${Math.round(trigger.getBoundingClientRect().bottom + 10)}px`
        : "";
    };
    place();
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // Capture phase: the containment check must read the DOM before React's
    // own pointerdown handlers run — a nested control (e.g. a ComboField
    // option) can unmount its target during the same event, and a bubble-
    // phase check would then see "outside" and wrongly close the panel.
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cx("fpop", align === "end" && "fpop--end")}>
      <button
        ref={triggerRef}
        type="button"
        className={cx("fbtn", valueLabel && "is-on")}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={valueLabel ? `${label} filter — ${valueLabel}` : `${label} filter`}
        onClick={() => setOpen((v) => !v)}
      >
        {valueLabel ?? label}
        <span className="fpop__caret" aria-hidden="true">
          ⌄
        </span>
      </button>
      {/* Mounted while closed so the fields keep submitting with the form. */}
      <div
        ref={panelRef}
        className="fpop__panel"
        role="group"
        aria-label={`${label} filter`}
        hidden={!open}
      >
        {children}
        <button type="submit" className="btn w-full">
          Apply
        </button>
      </div>
    </div>
  );
}
