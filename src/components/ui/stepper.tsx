import type { ReactNode } from "react";

import { cx } from "@/lib/format";

export type StepperStep = {
  label: ReactNode;
  /** Optional dim description line (`.step__d`). */
  desc?: ReactNode;
  state?: "done" | "now" | "todo";
  /** Trailing slot on the step — e.g. a `chip chip--ok` "Done". */
  end?: ReactNode;
};

/**
 * The `.steps` progress recipe — auto-numbered 01/02 rail with a live numeral
 * on the current step. `aria-current="step"` lands on the `now` step.
 * Workflow *state* stays with the feature; this is only the rail.
 */
export function Stepper({
  steps,
  label = "Progress",
  className,
}: {
  steps: StepperStep[];
  /** Accessible name for the `<ol>`. */
  label?: string;
  className?: string;
}) {
  return (
    <ol className={cx("steps list-none p-0 m-0", className)} aria-label={label}>
      {steps.map((step, index) => (
        <li
          key={index}
          className={cx(
            "step",
            step.state === "done" && "is-done",
            step.state === "now" && "is-now",
          )}
          aria-current={step.state === "now" ? "step" : undefined}
        >
          <span className="step__n" aria-hidden="true" />
          <span className="step__t">{step.label}</span>
          {step.desc && <span className="step__d">{step.desc}</span>}
          {step.end}
        </li>
      ))}
    </ol>
  );
}
