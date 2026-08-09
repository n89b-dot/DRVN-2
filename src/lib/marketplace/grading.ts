import type { ConditionGrade, Json } from "@/lib/database.types";

/**
 * Condition grading (migration 0024) — the letter grade and per-category
 * checklist a seller declares at listing time. Together with the photos they
 * are the contract a "not as described" dispute is judged against, so every
 * definition here is written for the buyer reading it at point of sale, not
 * for the seller flattering their part.
 *
 * Grades follow the salvage-industry A/B/C convention: conservative,
 * three steps, no "mint". New parts don't take a grade — "new" already says
 * everything a grade would.
 */

export const GRADES: { value: ConditionGrade; label: string; meaning: string }[] = [
  {
    value: "a",
    label: "Grade A",
    meaning: "Fully functional, light cosmetic wear at most. Ready to fit.",
  },
  {
    value: "b",
    label: "Grade B",
    meaning: "Fully functional with visible wear — scratches, scuffs, faded finish.",
  },
  {
    value: "c",
    label: "Grade C",
    meaning: "Works, but has a defect the description discloses — buyer should read it.",
  },
];

export function gradeLabel(value: string | null | undefined): string | null {
  return GRADES.find((g) => g.value === value)?.label ?? null;
}

export function gradeMeaning(value: string | null | undefined): string | null {
  return GRADES.find((g) => g.value === value)?.meaning ?? null;
}

export type ChecklistAnswer = "yes" | "no" | "unknown";
export type ChecklistQuestion = {
  key: string;
  /** Asked of the seller — phrased so "yes" is always the good answer. */
  label: string;
};

const COMMON: ChecklistQuestion[] = [
  { key: "photos_actual", label: "Photos show this exact part (not stock images)" },
  { key: "complete", label: "Complete — all hardware/pieces needed to fit it are included" },
];

/**
 * Per-category questions, keyed by top-level category slug from taxonomy.ts,
 * with subcategory overrides where the generic set would miss what actually
 * fails on that part. 3–5 questions each — a contract, not a form marathon.
 */
const CATEGORY_QUESTIONS: Record<string, ChecklistQuestion[]> = {
  performance: [
    { key: "working_pull", label: "Working when removed / pulled from a running car" },
    { key: "no_leaks", label: "Free of leaks, cracks and weld repairs" },
  ],
  engine: [
    { key: "working_pull", label: "Working when removed / pulled from a running car" },
    { key: "mileage_known", label: "Mileage on the part is known and stated in the description" },
    { key: "no_leaks", label: "Free of leaks, cracks and damaged threads" },
  ],
  "exterior-body": [
    { key: "no_cracks", label: "Free of cracks, breaks and previous repairs" },
    { key: "mounts_intact", label: "All mounting tabs and points are intact" },
  ],
  "interior-lighting": [
    { key: "fully_working", label: "All functions work (motors, heaters, bulbs, pixels)" },
    { key: "no_damage", label: "Free of tears, cracks and broken clips" },
  ],
  "brakes-suspension": [
    { key: "working_pull", label: "Working when removed — no leaks, seized parts or play" },
    { key: "life_left", label: "Meaningful service life left (pad/rotor/damper wear stated)" },
  ],
  "wheels-tires": [
    { key: "straight", label: "Straight — no bends, cracks or welds" },
    { key: "no_curb", label: "Free of curb rash beyond what the photos show" },
    { key: "tread_stated", label: "Tire tread depth / date codes stated (if tires included)" },
  ],
};

const SUBCATEGORY_QUESTIONS: Record<string, ChecklistQuestion[]> = {
  turbo: [
    { key: "shaft_play", label: "No detectable shaft play" },
    { key: "no_oil", label: "No oil in the intake or exhaust housings" },
    { key: "working_pull", label: "Boosting normally when removed" },
  ],
  tuning: [
    { key: "unmarried", label: "Unlocked / unmarried from the previous car (ECU, tuner, etc.)" },
    { key: "fully_working", label: "Fully working when removed" },
  ],
};

/** The checklist for a listing: common questions + the category's own. */
export function checklistFor(category: string, subcategory: string | null): ChecklistQuestion[] {
  const specific =
    (subcategory && SUBCATEGORY_QUESTIONS[subcategory]) ||
    CATEGORY_QUESTIONS[category] ||
    [];
  return [...specific, ...COMMON];
}

const ANSWERS: ChecklistAnswer[] = ["yes", "no", "unknown"];

/**
 * Validates raw form/JSON answers against the catalog for this category.
 * Unknown keys and malformed values are dropped rather than erroring — the
 * catalog can evolve while old drafts still save. Returns null when nothing
 * valid was answered.
 */
export function sanitizeChecklist(
  category: string,
  subcategory: string | null,
  raw: unknown
): Record<string, ChecklistAnswer> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const allowed = new Set(checklistFor(category, subcategory).map((q) => q.key));
  const out: Record<string, ChecklistAnswer> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (allowed.has(key) && ANSWERS.includes(value as ChecklistAnswer)) {
      out[key] = value as ChecklistAnswer;
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Reads stored checklist answers back into display rows, catalog-ordered. */
export function checklistRows(
  category: string,
  subcategory: string | null,
  stored: Json | null
): { key: string; label: string; answer: ChecklistAnswer }[] {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return [];
  const answers = stored as Record<string, unknown>;
  return checklistFor(category, subcategory).flatMap((q) => {
    const answer = answers[q.key];
    return ANSWERS.includes(answer as ChecklistAnswer)
      ? [{ key: q.key, label: q.label, answer: answer as ChecklistAnswer }]
      : [];
  });
}
