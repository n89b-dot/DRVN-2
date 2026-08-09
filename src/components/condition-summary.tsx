import type { Json } from "@/lib/database.types";
import { checklistRows, gradeLabel, gradeMeaning, type ChecklistAnswer } from "@/lib/marketplace/grading";
import { conditionLabel } from "@/lib/marketplace/taxonomy";

/**
 * The shape written into order_items.condition_snapshot by the 0024 trigger
 * (jsonb_strip_nulls, so any of these keys may simply be absent) — also the
 * shape a listing's own condition fields collapse into for the admin
 * purchased-vs-current comparison. Loosely typed against `Json` because
 * that's what both callers actually hold.
 */
export type ConditionSnapshot = {
  condition?: string | null;
  grade?: string | null;
  checklist?: Json | null;
  compatibility_notes?: string | null;
} | null;

/** Title-cases a raw checklist key ("no_leaks" → "No leaks") — the fallback
 *  label when the category catalog needed to resolve the real question text
 *  (checklistRows) isn't available, e.g. the listing behind an order was
 *  hard-deleted and only the frozen snapshot survives. */
function humanizeKey(key: string): string {
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const KNOWN_ANSWERS: ChecklistAnswer[] = ["yes", "no", "unknown"];

function rawChecklistRows(stored: Json | null | undefined): { key: string; label: string; answer: ChecklistAnswer }[] {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return [];
  return Object.entries(stored as Record<string, unknown>).flatMap(([key, value]) =>
    KNOWN_ANSWERS.includes(value as ChecklistAnswer)
      ? [{ key, label: humanizeKey(key), answer: value as ChecklistAnswer }]
      : []
  );
}

function answerChipClass(answer: ChecklistAnswer): string {
  if (answer === "yes") return "chip chip--ok";
  if (answer === "no") return "chip chip--spent";
  return "chip";
}

/**
 * Renders a condition snapshot — grade, condition, per-question checklist,
 * compatibility notes — in the Livesheet style shared by the listing detail
 * page, the buyer/seller order page, and the admin order comparison.
 *
 * Pass `category`/`subcategory` when known (current listing, or an order
 * item whose listing still exists) so the checklist renders the catalog's
 * real question text via checklistRows(); without them this falls back to
 * humanized raw keys so a snapshot from a deleted listing still reads.
 */
export function ConditionSummary({
  snapshot,
  category,
  subcategory,
  label = "Condition",
  note,
}: {
  snapshot: ConditionSnapshot;
  category?: string | null;
  subcategory?: string | null;
  label?: string;
  note?: string;
}) {
  if (!snapshot) return null;

  const rows = category
    ? checklistRows(category, subcategory ?? null, snapshot.checklist ?? null)
    : rawChecklistRows(snapshot.checklist);

  const hasContent =
    Boolean(snapshot.grade) ||
    Boolean(snapshot.condition) ||
    rows.length > 0 ||
    Boolean(snapshot.compatibility_notes);
  if (!hasContent) return null;

  return (
    <div>
      <span className="microlabel microlabel--ink">{label}</span>
      {(snapshot.grade || snapshot.condition) && (
        <p className="mt-2 text-[14.5px]">
          {snapshot.grade && <span className="chip chip--ok">{gradeLabel(snapshot.grade)}</span>}{" "}
          {snapshot.grade && <span className="text-dim">{gradeMeaning(snapshot.grade)}</span>}
          {!snapshot.grade && snapshot.condition && (
            <span className="chip">{conditionLabel(snapshot.condition)}</span>
          )}
          {snapshot.grade && snapshot.condition && (
            <span className="text-dim"> · {conditionLabel(snapshot.condition)}</span>
          )}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {rows.map((row) => (
            <li key={row.key} className="flex items-baseline justify-between gap-3 text-[13.5px]">
              <span>{row.label}</span>
              <span className={answerChipClass(row.answer)}>
                {row.answer === "unknown" ? "Not sure" : row.answer}
              </span>
            </li>
          ))}
        </ul>
      )}
      {snapshot.compatibility_notes && (
        <p className="spec-note mt-2">{snapshot.compatibility_notes}</p>
      )}
      {note && <p className="spec-note mt-2">{note}</p>}
    </div>
  );
}

/** True when two condition snapshots materially disagree — grade or any
 *  checklist answer differs. Used by the admin purchased-vs-current
 *  comparison to flag a listing edited since the sale. Compatibility notes
 *  and free-text condition are informational, not "material" on their own. */
export function conditionMaterialDiff(a: ConditionSnapshot, b: ConditionSnapshot): boolean {
  if (!a || !b) return false;
  if ((a.grade ?? null) !== (b.grade ?? null)) return true;
  const aChecklist = (a.checklist ?? {}) as Record<string, unknown>;
  const bChecklist = (b.checklist ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(aChecklist), ...Object.keys(bChecklist)]);
  for (const key of keys) {
    if (aChecklist[key] !== bChecklist[key]) return true;
  }
  return false;
}
