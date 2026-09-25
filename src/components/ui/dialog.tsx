"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { springs, transitions } from "@/lib/motion";

import { lockModal, unlockModal, isTopModal } from "./modal-stack";

/** Native modal semantics provide inert background, nested top-layer ordering,
 * focus containment (including empty panels), Escape and focus restoration. */
export function Dialog({ open, onClose, label, children, className = "", align = "end" }: {
  open: boolean; onClose: () => void; label: string; children: React.ReactNode;
  className?: string; align?: "center" | "end";
}) {
  const modalRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = modalRef.current;
    if (!dialog || !open) return;
    lockModal(dialog);
    if (!dialog.open) dialog.showModal();
    return () => {
      dialog.close(); unlockModal(dialog);
    };
  }, [open]);

  return <dialog ref={modalRef} aria-label={label} tabIndex={-1}
    className={open ? `sheetwrap is-open ${align === "center" ? "!items-center" : ""}` : "hidden"}
    style={{ border: 0, margin: 0, maxWidth: "none", maxHeight: "none", width: "100%", height: "100%", padding: 0 }}
    onKeyDown={(event) => {
      const dialog = modalRef.current;
      if (!dialog || !isTopModal(dialog)) return;
      if (event.key === "Escape") { event.stopPropagation(); return; }
      if (event.key !== "Tab") return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(item => item.getClientRects().length && !item.closest("[inert]"));
      const first = items[0], last = items.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      if (!dialog.contains(document.activeElement) || document.activeElement === dialog || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    }}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    {open && <motion.div className={`dialogbox ${className}`} initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0, transition: { ...springs.spatial, opacity: transitions.standard } }}>
      {children}
      {/* Inside the panel's corner. After the children it floated on the
          scrim below the sheet, and read as a second, stray control. */}
      <button type="button" onClick={onClose} className="dialogbox__close" aria-label={`Close ${label}`}>Close</button>
    </motion.div>}
  </dialog>;
}
