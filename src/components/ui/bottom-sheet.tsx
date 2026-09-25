"use client";
import { lockModal, unlockModal, isTopModal } from "./modal-stack";

import { useCallback, useEffect, useRef, useState } from "react";

import { motion } from "motion/react";

import { cx } from "@/lib/format";
import { springs, transitions } from "@/lib/motion";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Matches the stylesheet's compact boundary (Tailwind `sm`). */
const COMPACT_QUERY = "(max-width: 639.98px)";
/** The desktop filter sidebar's boundary. Below this the same fields are a
 *  sheet; at or above it they are a column beside the results (M-3). One set
 *  of fields, two presentations — never two rendered copies of the state. */
const BELOW_LG_QUERY = "(max-width: 1023.98px)";

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
  align,
  className,
  children,
  closeLabel = "Done",
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the sheet. */
  label: string;
  /** Where the sheet stops being a sheet. "sm" dissolves it at ≥640px;
   *  "lg" holds it all the way to 1024px, which is what a filter SIDEBAR
   *  needs — a tablet has no room for a column beside four cards. Omit for
   *  an all-widths sheet. */
  inlineFrom?: "sm" | "lg";
  /** "center" floats the panel as a centered dialog ≥640px (compact stays a
   *  bottom sheet) — for all-widths sheets that would otherwise pin a
   *  full-width strip to a desktop viewport's bottom edge. */
  align?: "center";
  className?: string;
  children: React.ReactNode;
  /** Label of the phone-only dismiss control. `null` when the sheet's own
   *  content already ends in a Done/Cancel, so the two never stack. */
  closeLabel?: string | null;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  const restoreRef = useRef<HTMLElement | null>(null);
  // Dialog semantics only apply while the chrome is really a sheet.
  const [isCompact, setIsCompact] = useState(inlineFrom == null);

  useEffect(() => {
    if (inlineFrom == null) return;
    const mq = window.matchMedia(inlineFrom === "lg" ? BELOW_LG_QUERY : COMPACT_QUERY);
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
      if (event.defaultPrevented || !isTopModal(panelRef.current)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter((el) => el.offsetParent !== null);
      if (!focusable.length) { event.preventDefault(); panelRef.current.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (document.activeElement === panelRef.current || !panelRef.current.contains(document.activeElement)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    []
  );

  useEffect(() => {
    if (!sheetActive) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (!panel) return;
    lockModal(panel);
    document.addEventListener("keydown", handleKeyDown);
    // Focus the panel itself, not its first field — a combo field opens its
    // option list on focus, so field-first focus dropped a list over the
    // sheet the moment it opened. The dialog receives focus; Tab reaches
    // the first field.
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const restore = isTopModal(panel);
      unlockModal(panel);
      if (restore) restoreRef.current?.focus();
    };
  }, [sheetActive, handleKeyDown]);

  return (
    <div
      className={cx(
        "bsheet",
        (open || present) && "is-open",
        inlineFrom === "sm" && "bsheet--inline-sm",
        inlineFrom === "lg" && "bsheet--inline-lg",
        align === "center" && "bsheet--center"
      )}
      // While closed on compact, the chrome hides but the children stay in
      // the DOM (and in their form). `hidden` on the wrap would also hide the
      // inline composition, so it's driven by the classes instead.
      onClick={isCompact && open ? onClose : undefined}
    >
      <motion.div
        ref={panelRef}
        // Closed means no longer interactive — `inert` takes the panel out
        // of the focus order and accessibility tree the moment it starts
        // exiting, while its form fields stay mounted (inert fields still
        // submit with the parent form). Never inert in the ≥640px inline
        // composition, where the children are the live layout.
        inert={isCompact && !open ? true : undefined}
        // aria-hidden mirrors inert for assistive tech (and testing tools)
        // that don't honor inert yet — while closed on compact, the panel is
        // out of the accessibility tree, exactly as display:none had it.
        aria-hidden={isCompact && !open ? true : undefined}
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
        {isCompact && closeLabel !== null && (
          <button
            type="button"
            onClick={onClose}
            className="relbtn !static mx-auto mt-1 block min-h-[44px]"
            aria-label={`Close ${label}`}
          >
            {closeLabel}
          </button>
        )}
      </motion.div>
    </div>
  );
}
