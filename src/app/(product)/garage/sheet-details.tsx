"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * The sheet's measured half — dimensions, Latest, Next — folded on phones
 * behind a one-line digest so a garage of three cars is three cards tall,
 * not three screens. ≥641px the fold dissolves (CSS) and the toggle hides:
 * on desktop the plate sits beside the body, and a collapsed body would
 * leave the card's left half taller than its right.
 */
export function SheetDetails({ digest, children }: { digest: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        className="gsheet__toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="gsheet__digest">{digest}</span>
        <span className="gsheet__chev" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      </button>
      <div id={id} className={`gsheet__more${open ? " is-open" : ""}`}>
        {children}
      </div>
    </>
  );
}
