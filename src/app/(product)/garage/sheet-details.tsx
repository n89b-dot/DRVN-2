"use client";

import { useCallback, useId, useState, useSyncExternalStore, type ReactNode } from "react";

const DESKTOP = "(min-width: 641px)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/**
 * The sheet's measured half — dimensions, Latest, Next — behind a digest
 * row with an explicit "Show details / Hide details" control. Collapsible
 * at every width; the tool rail beneath it never folds, and on desktop the
 * sheet's height is the plate's, so toggling never moves the rail (the
 * details scroll inside their own pane if they run long).
 *
 * Default fold follows the viewport (open ≥641px, closed on phones) until
 * the first tap pins a choice; the viewport is read through
 * useSyncExternalStore so the server render leaves the class off and the
 * stylesheet's media fallback draws the same default without a flash.
 */
export function SheetDetails({ digest, children }: { digest: string; children: ReactNode }) {
  const [choice, setChoice] = useState<boolean | null>(null);
  const desktop = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP).matches,
    () => null
  );
  const id = useId();
  const open = choice ?? desktop;
  const state = open === null ? "" : open ? " is-open" : " is-closed";
  const toggle = useCallback(() => setChoice((c) => !(c ?? window.matchMedia(DESKTOP).matches)), []);

  return (
    <>
      <div className={`gsheet__toggle${state}`}>
        <span className="gsheet__digest">{digest}</span>
        <button
          type="button"
          className="gsheet__togglebtn"
          aria-controls={id}
          aria-expanded={open ?? false}
          suppressHydrationWarning
          onClick={toggle}
        >
          <span className="gsheet__chev-closed">Show details</span>
          <span className="gsheet__chev-open">Hide details</span>
          <svg className="gsheet__chevico" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div id={id} className={`gsheet__more${state}`}>
        {/* The pane is the grid's single row — the fold animates the row from
            1fr to 0fr on phones (a drawn unfold, not a jump cut) while the
            pane itself carries the content's fade and rise. */}
        <div className="gsheet__morepane">{children}</div>
      </div>
    </>
  );
}
