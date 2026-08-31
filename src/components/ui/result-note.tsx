"use client";

import { AnimatePresence, motion } from "motion/react";

import { cx } from "@/lib/format";
import { springs, transitions } from "@/lib/motion";

/**
 * Action outcome line — ok chip or error text, `role="alert"`. The
 * `state.error ? field__err : chip chip--ok` idiom copy-pasted across the
 * commerce forms.
 *
 * Motion gives the note presence: it rises in when a result lands and fades
 * out when the state clears, instead of popping — cause (the action) and
 * effect (the outcome) read as connected. Under reduced motion the rise is
 * dropped and only the opacity communicates the change.
 */
export function ResultNote({
  error,
  ok,
  className,
}: {
  error?: string | null;
  ok?: string | null;
  className?: string;
}) {
  const show = Boolean(error || ok);
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.p
          // Error → ok (or back) crossfades rather than morphing one chip.
          key={error ? "error" : "ok"}
          role="alert"
          aria-live="polite"
          className={cx(error ? "field__err" : "chip chip--ok", className)}
          initial={{ opacity: 0, y: 6 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { ...springs.responsive, opacity: transitions.fast },
          }}
          exit={{ opacity: 0, transition: transitions.fast }}
        >
          {error ?? ok}
        </motion.p>
      )}
    </AnimatePresence>
  );
}
