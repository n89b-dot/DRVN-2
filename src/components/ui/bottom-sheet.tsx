"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { motion } from "motion/react";

import { cx } from "@/lib/format";
import { springs, transitions } from "@/lib/motion";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Matches the stylesheet's compact boundary (Tailwind `sm`). */
const COMPACT_QUERY = "(max-width: 639.98px)";

/**
 * The compact-screen sheet — Material's bottom-sheet behavior in Livesheet's
 * dialog language: the same `.sheet` tile plate, risen from the bottom edge,
 * full-width with safe-area padding, scrim behind, Esc/trap/restore like
 * Dialog.
 *
 * Two properties distinguish it from Dialog:
 *
 * 1. **Children stay mounted while closed** (`hidden` attribute, not
 *    unmounted) — so form fields inside it keep submitting with their parent
 *    form. That is what lets a GET-form filter bar move its refinements into
 *    a sheet without changing URL behavior.
 * 2. **It can dissolve above compact** (`inlineFrom="sm"`): at ≥640px the
 *    chrome becomes `display: contents`, the children flow back into their
 *    parent layout (e.g. a `.finder__refine` row), and dialog semantics are
 *    dropped. One DOM, two compositions — never two copies of the controls.
 *
 * Use where a desktop interaction would otherwise stack into an over-dense
 * compact column: dense filtering, contextual selectors, action menus.
 */
export function BottomSheet({
  open,
  onClose,
  label,
  inlineFrom,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the sheet. */
  label: string;
  /** When "sm", the sheet only exists on compact — wider widths render the
   *  children inline where the component sits. Omit for an all-widths sheet. */
  inlineFrom?: "sm";
  className?: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  // Dialog semantics only apply while the chrome is really a sheet.
  const [isCompact, setIsCompact] = useState(inlineFrom == null);

  useEffect(() => {
    if (inlineFrom == null) return;
    const mq = window.matchMedia(COMPACT_QUERY);
    const sync = () => setIsCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [inlineFrom]);

  const sheetActive = open && isCompact;

  // The sheet's children must stay mounted while closed (their form fields
  // keep submitting with the parent form), so AnimatePresence-style
  // unmounting is off the table. Instead the always-mounted panel animates
  // between open/closed and `present` keeps the scrim displayed until the
  // exit settles — the old CSS version snapped to display:none instantly.
  const [present, setPresent] = useState(open);
  // Render-phase adjustment (not an effect): opening must display the wrap
  // in the same render the panel starts animating in.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setPresent(true);
  }

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter((el) => el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!sheetActive) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    const focusTarget =
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panelRef.current;
    focusTarget?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus();
    };
  }, [sheetActive, handleKeyDown]);

  return (
    <div
      className={cx(
        "bsheet",
        (open || present) && "is-open",
        inlineFrom === "sm" && "bsheet--inline-sm"
      )}
      // While closed on compact, the chrome hides but the children stay in
      // the DOM (and in their form). `hidden` on the wrap would also hide the
      // inline composition, so it's driven by the classes instead.
      onClick={isCompact && open ? onClose : undefined}
    >
      <motion.div
        ref={panelRef}
        // In the ≥640px inline composition the panel is display:contents, so
        // these inline styles have no box to apply to — the values are
        // harmless there and load-bearing on compact.
        initial={false}
        animate={
          sheetActive || !isCompact
            ? { opacity: 1, y: 0, transition: { ...springs.spatial, opacity: transitions.standard } }
            : { opacity: 0, y: 24, transition: transitions.fast }
        }
        onAnimationComplete={() => {
          if (!open) setPresent(false);
        }}
        role={sheetActive ? "dialog" : undefined}
        aria-modal={sheetActive ? "true" : undefined}
        aria-label={sheetActive ? label : undefined}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={cx("bsheet__panel", className)}
      >
        {children}
        {isCompact && (
          <button
            type="button"
            onClick={onClose}
            className="btn w-full"
            aria-label={`Close ${label}`}
          >
            Done
          </button>
        )}
      </motion.div>
    </div>
  );
}
