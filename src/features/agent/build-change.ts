import type { TurnCard } from "@/lib/ai/run";

/**
 * The pure half of "Update my build": what a confirmed draft does to the mod
 * sheet, the way the mods editor's Replace does it (the old line is marked
 * removed and keeps its id; the new line takes its place, just above it).
 * Shared by the chat's Confirm and the editor's prefilled Edit.
 */

export type BuildDraft = Extract<TurnCard, { kind: "build_change" }>;

export type SheetRow = {
  id: string;
  group_label: string;
  brand: string | null;
  product: string | null;
  part_number: string | null;
  category: string | null;
  confidence: number | null;
  raw_text: string | null;
  position: number;
  status: string;
  product_url: string | null;
  image_url: string | null;
  source_domain: string | null;
  ref_price_cents: number | null;
  ref_price_currency: string | null;
  origin: string | null;
};

/** Which build-sheet group a part's category lands in (MOD_GROUPS). */
export function groupForCategory(category: string | null): string {
  switch (category) {
    case "suspension":
      return "Suspension";
    case "wheels":
      return "Wheels & Tires";
    case "aero-exterior":
      return "Exterior";
    case "interior":
      return "Interior";
    case "exhaust":
    case "intake":
    case "turbo":
    case "ecu-tune":
    case "brakes":
    case "drivetrain":
      return "Performance";
    default:
      return "Other";
  }
}

export type BuildChangePlan =
  | { kind: "saved"; sellHref: string | null }
  | { kind: "stale" }
  | { kind: "save"; items: ReturnType<typeof toItem>[]; sellHref: string | null };

function toItem(row: SheetRow, position: number) {
  return {
    id: row.id,
    group_label: row.group_label,
    brand: row.brand,
    product: row.product,
    part_number: row.part_number,
    category: row.category,
    confidence: row.confidence,
    raw_text: row.raw_text ?? `${row.brand ?? ""} ${row.product ?? ""}`.trim(),
    position,
    status: row.status === "removed" ? ("removed" as const) : ("installed" as const),
    product_url: row.product_url,
    image_url: row.image_url,
    source_domain: row.source_domain,
    ref_price_cents: row.ref_price_cents,
    ref_price_currency: row.ref_price_currency,
    origin: row.origin === "stock" ? ("stock" as const) : ("aftermarket" as const),
  };
}

/** The new line a draft describes, ready to sit in the sheet. */
export function draftRow(draft: BuildDraft, groupLabel?: string): SheetRow {
  return {
    id: draft.id,
    group_label: groupLabel ?? groupForCategory(draft.category),
    brand: draft.brand,
    product: draft.product,
    part_number: draft.part_number,
    category: draft.category,
    confidence: null,
    raw_text: [draft.brand, draft.product].filter(Boolean).join(" "),
    position: 0,
    status: "installed",
    product_url: draft.product_url,
    image_url: draft.image_url,
    source_domain: null,
    ref_price_cents: null,
    ref_price_currency: null,
    origin: "aftermarket",
  };
}

export function buildChangeItems(rows: SheetRow[], draft: BuildDraft): BuildChangePlan {
  const sellHref = draft.replaces ? `/sell?car=${draft.car}&mod=${draft.replaces}` : null;
  if (rows.some((row) => row.id === draft.id)) return { kind: "saved", sellHref };
  const sheet = [...rows].sort((a, b) => a.position - b.position);
  const index = draft.replaces ? sheet.findIndex((row) => row.id === draft.replaces) : -1;
  if (draft.replaces && (index < 0 || sheet[index].status !== "installed")) return { kind: "stale" };
  if (index >= 0) {
    const old = sheet[index];
    sheet[index] = { ...old, status: "removed" };
    sheet.splice(index, 0, draftRow(draft, old.group_label));
  } else {
    sheet.push(draftRow(draft));
  }
  return { kind: "save", items: sheet.map((row, position) => toItem(row, position)), sellHref };
}
