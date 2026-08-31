"use client";

import { useCallback, useEffect, useRef } from "react";

import { AnimatePresence, motion } from "motion/react";

import { springs, transitions } from "@/lib/motion";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * One modal primitive for the sheets and lightboxes.
 *
 * The three modals in the app were click-away `div`s: no dialog role, no Esc, no
 * focus trap, and no focus restore — so keyboard and screen-reader users could
 * neither close them nor tell they had opened. This provides all four, plus
 * body-scroll locking, and keeps the existing `.sheetwrap` visual language.
 */
export function Dialog({
  open,
  onClose,
  label,
  children,
  className = "",
  align = "end",
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name — required, since these have no persistent heading. */
  label: string;
  children: React.ReactNode;
  className?: string;
  align?: "center" | "end";
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;

      // Focus trap: cycle within the panel instead of escaping to the page
      // behind, which is covered and inert to the eye but not to the keyboard.
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
    if (!open) return;

    restoreRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    // Move focus into the dialog so the next Tab stays inside it.
    const focusTarget =
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panelRef.current;
    focusTarget?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      // Return focus to whatever opened the dialog.
      restoreRef.current?.focus();
    };
  }, [open, handleKeyDown]);

  // AnimatePresence keeps the dialog in the tree while it exits, which is
  // what finally gives the modals a real close animation — the old CSS
  // version unmounted instantly and relied on @starting-style for entry.
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={`sheetwrap is-open ${align === "center" ? "!items-center" : ""}`}
          // Clicking the backdrop closes; clicks inside the panel must not.
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: transitions.fast }}
          exit={{ opacity: 0, transition: transitions.fast }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            className={className}
            initial={{ opacity: 0, y: 16 }}
            animate={{
              opacity: 1,
              y: 0,
              transition: { ...springs.spatial, opacity: transitions.standard },
            }}
            exit={{ opacity: 0, y: 8, transition: transitions.fast }}
          >
            {children}
            <button
              type="button"
              onClick={onClose}
              className="relbtn !static mt-3"
              aria-label={`Close ${label}`}
            >
              Close
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
