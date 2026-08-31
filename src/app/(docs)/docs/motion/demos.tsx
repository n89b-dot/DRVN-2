"use client";

import { useState } from "react";

import { AnimatePresence, motion } from "motion/react";

import { ResultNote } from "@/components/ui";
import { expand, press, springs, transitions } from "@/lib/motion";

/**
 * Live specimens for /docs/motion — the demos are the documentation: a
 * developer should *feel* the difference between the spring presets, not
 * read stiffness numbers. Route-local by design (docs specimen furniture,
 * not a product component).
 */

const SPRING_PRESETS = [
  { key: "snappy", label: "snappy", spring: springs.snappy, use: "presses, toggles" },
  { key: "responsive", label: "responsive", spring: springs.responsive, use: "menus, notes" },
  { key: "spatial", label: "spatial", spring: springs.spatial, use: "sheets, dialogs" },
  { key: "gentle", label: "gentle", spring: springs.gentle, use: "narrative settling" },
] as const;

/** Click to send each preset's plate across the track — same distance, four temperaments. */
export function SpringComparison() {
  const [flipped, setFlipped] = useState(false);
  return (
    <div className="grid gap-2">
      {SPRING_PRESETS.map(({ key, label, spring, use }) => (
        <div key={key} className="flex items-center gap-3">
          <span className="microlabel w-24 shrink-0 !mb-0">{label}</span>
          <div className="relative h-6 flex-1 rounded-meter bg-paper-deep">
            <motion.span
              className="absolute top-1 h-4 w-4 rounded-chip bg-live"
              animate={{ left: flipped ? "calc(100% - 24px)" : "8px" }}
              transition={spring}
            />
          </div>
          <span className="microlabel w-32 shrink-0 !mb-0 text-right">{use}</span>
        </div>
      ))}
      <button type="button" className="btn btn--ghost mt-2 w-fit" onClick={() => setFlipped((f) => !f)}>
        Run the springs
      </button>
    </div>
  );
}

/** The `expand` recipe — height-auto disclosure. */
export function ExpandDemo() {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-2">
      <button type="button" className="btn btn--ghost w-fit" onClick={() => setOpen((o) => !o)}>
        {open ? "Collapse" : "Expand"}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            variants={expand}
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
            className="overflow-hidden"
          >
            <p className="spec-note !mt-0 border-t border-rule-soft pt-2">
              Disclosure content unfolds — the surrounding layout makes room instead of jumping.
              Used by the offer counter composer, ledger detail rows and the publish checklist.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** ResultNote presence — the same component the commerce forms render. */
export function PresenceDemo() {
  const [state, setState] = useState<"idle" | "ok" | "error">("idle");
  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <button type="button" className="btn btn--ghost" onClick={() => setState("ok")}>
          Succeed
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setState("error")}>
          Fail
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setState("idle")}>
          Clear
        </button>
      </div>
      <ResultNote
        ok={state === "ok" ? "Saved — the note rose in with the responsive spring." : null}
        error={state === "error" ? "That didn't send — errors use the same presence." : null}
      />
    </div>
  );
}

/** The `press` recipe — mechanical give on tap. */
export function PressDemo() {
  return (
    <div className="flex items-center gap-3">
      <motion.button type="button" className="btn" {...press}>
        Press and hold
      </motion.button>
      <span className="spec-note !mt-0">scale 0.97, snappy spring — felt, not seen.</span>
    </div>
  );
}

/** Replayable reveal — the Rv contract at documentation scale. */
export function RevealDemo() {
  const [runId, setRunId] = useState(0);
  return (
    <div className="grid gap-2">
      <button type="button" className="btn btn--ghost w-fit" onClick={() => setRunId((n) => n + 1)}>
        Replay reveal
      </button>
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={`${runId}-${i}`}
            className="tile !mb-0 flex-1 !p-3"
            initial={{ opacity: 0, y: 12, scale: 0.985 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              transition: {
                ...transitions.move,
                delay: i * 0.07,
                opacity: { ...transitions.move, ease: "easeOut", delay: i * 0.07 },
              },
            }}
          >
            <span className="microlabel !mb-0">stagger {i}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
