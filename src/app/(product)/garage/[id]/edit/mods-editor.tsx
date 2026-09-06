"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { ActionFooter, Button } from "@/components/ui";
import type { ModItem } from "@/lib/database.types";
import {
  isLowConfidence,
  MOD_CATEGORIES,
  MOD_GROUPS,
  parsePasteText,
  type ModCategory,
} from "@/lib/mods/parse";

import { unlinkModListing } from "@/app/(product)/sell/actions";

import { saveModItems, type ModItemInput } from "../../actions";

export { MOD_GROUPS };

const CATEGORY_LABELS: Record<ModCategory, string> = {
  suspension: "Suspension",
  exhaust: "Exhaust",
  intake: "Intake",
  turbo: "Turbo",
  wheels: "Wheels",
  brakes: "Brakes",
  "ecu-tune": "ECU / Tune",
  "aero-exterior": "Aero / Exterior",
  interior: "Interior",
  drivetrain: "Drivetrain",
};

type Row = {
  key: string;
  /** The saved mod_items id, or null for a line not yet filed. Only a saved
   *  line can be released for sale — the listing links back to this id. */
  id: string | null;
  group_label: string;
  brand: string;
  product: string;
  part_number: string;
  category: ModCategory | null;
  /** null for hand-added / previously-saved rows with no parser opinion. */
  confidence: number | null;
  raw_text: string;
  /** Set once this line has been released for sale — drives the Unlink control. */
  linked_listing_id: string | null;
};

/**
 * Heuristic paste parser (PRD §7.3 — the AI parse is the later upgrade path).
 * Lines that look like group headers ("Performance:", "EXTERIOR") set the
 * current group; other non-empty lines become items with a brand (curated
 * multi-word list, falling back to first-word), inferred category, extracted
 * part number, and a confidence score the UI uses to flag rows worth a
 * second look.
 */
function parsePaste(text: string): Row[] {
  return parsePasteText(text).map((r) => ({
    key: crypto.randomUUID(),
    id: null,
    linked_listing_id: null,
    ...r,
  }));
}

const inputClass = "ctl";

export function ModsEditor({ carId, initialMods }: { carId: string; initialMods: ModItem[] }) {
  const [rows, setRows] = useState<Row[]>(
    initialMods.map((m) => ({
      key: m.id,
      id: m.id,
      group_label: m.group_label,
      brand: m.brand ?? "",
      product: m.product ?? "",
      part_number: m.part_number ?? "",
      category: (m.category as ModCategory | null) ?? null,
      confidence: m.confidence,
      raw_text: m.raw_text ?? "",
      linked_listing_id: m.linked_listing_id,
    }))
  );
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(initialMods.length === 0);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const [unlinkPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const pending = saving || unlinkPending;
  const [unlinkingKey, setUnlinkingKey] = useState<string | null>(null);
  // Passive post-save affordance (brief §W1): when a save meaningfully changed
  // the build, one quiet inline line offers to turn it into an update. Never a
  // modal, never repeated — dismissing it (or saving again without changes)
  // clears it, and ignoring it costs nothing.
  const [suggestion, setSuggestion] = useState<{ added: string[]; removed: string[] } | null>(null);

  function unlink(row: Row) {
    if (!row.id) return;
    setUnlinkingKey(row.key);
    const formData = new FormData();
    formData.set("mod_item_id", row.id);
    formData.set("car_id", carId);
    startTransition(async () => {
      const result = await unlinkModListing(formData);
      if (result?.error) {
        // Surface the refusal in the editor's existing status line instead of
        // clearing the link locally while the server kept it.
        setStatus({ kind: "error", message: result.error });
      } else {
        updateRow(row.key, { linked_listing_id: null });
      }
      setUnlinkingKey(null);
    });
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function save() {
    if (savingRef.current || unlinkPending) return;
    savingRef.current = true;
    setSaving(true);
    setStatus(null);
    const items: ModItemInput[] = rows.map((r, i) => ({
      id: r.id ?? r.key,
      group_label: r.group_label,
      brand: r.brand.trim() || null,
      product: r.product.trim() || null,
      part_number: r.part_number.trim() || null,
      category: r.category,
      confidence: r.confidence,
      raw_text: r.raw_text || `${r.brand} ${r.product}`.trim(),
      position: i,
    }));
    try {
      let result: Awaited<ReturnType<typeof saveModItems>>;
      try {
        result = await saveModItems(carId, items);
      } catch (error) {
        unstable_rethrow(error);
        // The request may have committed before its response disappeared. Keep
        // every draft value and the client UUIDs so retrying converges on the
        // same rows instead of forcing a reload or creating duplicates.
        setStatus({
          kind: "error",
          message: "Couldn't confirm the save. Your changes are still here — try again.",
        });
        return;
      }
      setStatus(
        result.error
          ? { kind: "error", message: result.error }
          : { kind: "ok", message: "Saved ✓" }
      );
      if (!result.error) {
        // New rows use their client UUID as the durable database id. Promote
        // that id locally so an ordinary second save and a response-loss retry
        // update the same row instead of inserting a duplicate.
        setRows((current) =>
          current.map((row) => (row.id ? row : { ...row, id: row.key }))
        );
        const label = (row: { brand?: string | null; product?: string | null; raw_text?: string | null }) =>
          [row.brand, row.product].filter(Boolean).join(" ").trim() || (row.raw_text ?? "").trim();
        const before = new Set(initialMods.map((m) => label(m)).filter(Boolean));
        const after = new Set(rows.map((r) => label(r)).filter(Boolean));
        const added = [...after].filter((l) => !before.has(l)).slice(0, 3);
        const removed = [...before].filter((l) => !after.has(l)).slice(0, 3);
        setSuggestion(added.length || removed.length ? { added, removed } : null);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="tile">
      <div className="tile__head">
        <span className="microlabel microlabel--ink">The build — seed the lines</span>
        <Button variant="ghost" onClick={() => setShowPaste((s) => !s)}>
          Paste a list
        </Button>
      </div>

      {showPaste && (
        <div className="mt-4">
          <label htmlFor="mods-paste" className="sr-only">
            Paste your mod list
          </label>
          <textarea
            id="mods-paste"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={6}
            placeholder={"Paste your mod list, e.g.\n\nPerformance:\n034 High-flow downpipe\nCTS turbo inlet\n\nSuspension:\nKW V3 coilovers"}
            className="ctl"
          />
          <div className="mt-2 flex justify-end">
            <Button
              onClick={() => {
                setRows((r) => [...r, ...parsePaste(paste)]);
                setPaste("");
                setShowPaste(false);
              }}
              disabled={!paste.trim()}
            >
              Parse into items
            </Button>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        /* Phones close the gap to zero: each record already separates itself
           with its own top rule, and 8px on top of that reads as a stray band
           between lines rather than as a ruled sheet. */
        <div className="mt-4 flex flex-col gap-2 max-sm:gap-0">
          <p className="field__hint">Confirm or edit the parsed lines before saving.</p>
          {rows.map((row, index) => (
            /* Desktop: a ledger line. Phone: a labelled record — see `.modrow`
               in globals.css. The head/foot wrappers are `display: contents`
               on desktop, so this is one set of controls at both widths, not
               two rendered copies of the same state. */
            <div key={row.key} className="modrow">
              <span className="modrow__head">
                <span className="modrow__n" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <label htmlFor={`${row.key}-group`} className="modrow__lab">
                  Group
                </label>
                <select
                  id={`${row.key}-group`}
                  value={row.group_label}
                  onChange={(e) => updateRow(row.key, { group_label: e.target.value })}
                  className="ctl w-full shrink-0 sm:w-[130px]"
                >
                  {MOD_GROUPS.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </span>
              <label htmlFor={`${row.key}-brand`} className="modrow__lab">
                Brand
              </label>
              <input
                id={`${row.key}-brand`}
                value={row.brand}
                onChange={(e) => updateRow(row.key, { brand: e.target.value })}
                placeholder="Brand"
                className={`${inputClass} w-full shrink-0 sm:w-[110px]`}
              />
              <label htmlFor={`${row.key}-product`} className="modrow__lab">
                Product
              </label>
              <input
                id={`${row.key}-product`}
                value={row.product}
                onChange={(e) => updateRow(row.key, { product: e.target.value })}
                placeholder="Product"
                className="ctl w-full max-w-none flex-1 sm:min-w-[150px]"
              />
              <label htmlFor={`${row.key}-part`} className="modrow__lab">
                Part number
              </label>
              <input
                id={`${row.key}-part`}
                value={row.part_number}
                onChange={(e) => updateRow(row.key, { part_number: e.target.value })}
                placeholder="Part no."
                className={`${inputClass} w-full shrink-0 sm:w-[110px]`}
              />
              <label htmlFor={`${row.key}-category`} className="modrow__lab">
                Category
              </label>
              <select
                id={`${row.key}-category`}
                value={row.category ?? ""}
                onChange={(e) =>
                  updateRow(row.key, { category: (e.target.value || null) as ModCategory | null })
                }
                className="ctl w-full shrink-0 sm:w-[130px]"
              >
                <option value="">Category</option>
                {MOD_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
              {row.confidence !== null && isLowConfidence(row.confidence) && (
                <span
                  className="chip chip--live mt-2 shrink-0 self-start sm:mt-0 sm:self-auto"
                  title="Low-confidence parse — check this line before saving"
                >
                  Check this
                </span>
              )}
              <span className="modrow__foot">
                {/* Release is only offered on a filed line: the listing links back
                    to this row's id, so an unsaved row has nothing to attach to. */}
                {row.id ? (
                  row.linked_listing_id ? (
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Link
                        href={`/listings/${row.linked_listing_id}`}
                        className="chip chip--ok !static"
                        title="See the listing this line released"
                      >
                        For sale
                      </Link>
                      <button
                        type="button"
                        onClick={() => unlink(row)}
                        disabled={pending && unlinkingKey === row.key}
                        className="microlabel shrink-0 underline decoration-dotted transition hover:text-live disabled:opacity-50"
                        title="Unlink this line from its listing — the listing itself stays as-is"
                      >
                        {pending && unlinkingKey === row.key ? "Unlinking…" : "Unlink"}
                      </button>
                    </span>
                  ) : (
                    <Link
                      href={`/sell?car=${carId}&mod=${row.id}`}
                      className="relbtn !static shrink-0"
                      title="List this component for sale with its provenance attached"
                    >
                      Release
                    </Link>
                  )
                ) : (
                  <span className="microlabel shrink-0" title="Save the sheet before releasing">
                    Unfiled
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setRows((r) => r.filter((x) => x.key !== row.key))}
                  className="modrow__rm shrink-0 px-1"
                  aria-label="Remove mod"
                >
                  <span aria-hidden="true">✕</span>
                  <span className="modrow__rmtext" aria-hidden="true">
                    Remove
                  </span>
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <ActionFooter
        aux={
          <button
            type="button"
            onClick={() =>
              setRows((r) => [
                ...r,
                {
                  key: crypto.randomUUID(),
                  id: null,
                  group_label: "Other",
                  brand: "",
                  product: "",
                  part_number: "",
                  category: null,
                  confidence: null,
                  raw_text: "",
                  linked_listing_id: null,
                },
              ])
            }
            className="jumplink"
          >
            + Add a line manually
          </button>
        }
        status={status ? { kind: status.kind, message: status.message } : null}
      >
        <Button variant="live" onClick={save} loading={pending} pendingLabel="Saving…">
          Save the build
        </Button>
      </ActionFooter>

      {suggestion && (
        <p className="mt-3 flex flex-wrap items-center gap-3 text-micro text-dim" role="status">
          <span>
            Build updated
            {suggestion.added.length > 0 && ` — added ${suggestion.added.join(", ")}`}
            {suggestion.removed.length > 0 &&
              `${suggestion.added.length ? ";" : " —"} removed ${suggestion.removed.join(", ")}`}
            .
          </span>
          <Link
            href={`/garage/${carId}/update/new?added=${encodeURIComponent(suggestion.added.join("|"))}&removed=${encodeURIComponent(suggestion.removed.join("|"))}`}
            className="jumplink"
          >
            Create an update from these changes →
          </Link>
          <button
            type="button"
            className="jumplink"
            aria-label="Dismiss this suggestion"
            onClick={() => setSuggestion(null)}
          >
            ✕
          </button>
        </p>
      )}
    </section>
  );
}
