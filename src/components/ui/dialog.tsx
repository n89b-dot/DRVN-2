"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { springs, transitions } from "@/lib/motion";

const openDialogs = new Set<HTMLDialogElement>();
let previousOverflow = "";

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
    if (!openDialogs.size) { previousOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
    openDialogs.add(dialog);
    if (!dialog.open) dialog.showModal();
    return () => {
      dialog.close(); openDialogs.delete(dialog);
      if (!openDialogs.size) document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return <dialog ref={modalRef} aria-label={label} tabIndex={-1}
    className={open ? `sheetwrap is-open ${align === "center" ? "!items-center" : ""}` : "hidden"}
    style={{ border: 0, margin: 0, maxWidth: "none", maxHeight: "none", width: "100%", height: "100%", padding: 0 }}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    {open && <motion.div className={className} initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0, transition: { ...springs.spatial, opacity: transitions.standard } }}>
      {children}
      <button type="button" onClick={onClose} className="relbtn !static mt-3" aria-label={`Close ${label}`}>Close</button>
    </motion.div>}
  </dialog>;
}
