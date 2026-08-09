"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

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

const inputClass = "ctl !py-2";

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
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [unlinkingKey, setUnlinkingKey] = useState<string | null>(null);

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
        setStatus(result.error);
      } else {
        updateRow(row.key, { linked_listing_id: null });
      }
      setUnlinkingKey(null);
    });
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function save() {
    setStatus(null);
    const items: ModItemInput[] = rows.map((r, i) => ({
      id: r.id,
      group_label: r.group_label,
      brand: r.brand.trim() || null,
      product: r.product.trim() || null,
      part_number: r.part_number.trim() || null,
      category: r.category,
      confidence: r.confidence,
      raw_text: r.raw_text || `${r.brand} ${r.product}`.trim(),
      position: i,
    }));
    startTransition(async () => {
      const result = await saveModItems(carId, items);
      setStatus(result.error ?? "Saved.");
    });
  }

  return (
    <section className="tile">
      <div className="tile__head">
        <span className="microlabel microlabel--ink">The build — seed the lines</span>
        <button
          type="button"
          onClick={() => setShowPaste((s) => !s)}
          className="btn btn--ghost"
        >
          Paste a list
        </button>
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
            <button
              type="button"
              onClick={() => {
                setRows((r) => [...r, ...parsePaste(paste)]);
                setPaste("");
                setShowPaste(false);
              }}
              disabled={!paste.trim()}
              className="btn"
            >
              Parse into items
            </button>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <p className="field__hint">Confirm or edit the parsed lines before saving.</p>
          {rows.map((row) => (
            <div key={row.key} className="flex flex-wrap items-center gap-2">
              <label htmlFor={`${row.key}-group`} className="sr-only">
                Group
              </label>
              <select
                id={`${row.key}-group`}
                value={row.group_label}
                onChange={(e) => updateRow(row.key, { group_label: e.target.value })}
                className="ctl !py-2 w-[130px] shrink-0"
              >
                {MOD_GROUPS.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
              <label htmlFor={`${row.key}-brand`} className="sr-only">
                Brand
              </label>
              <input
                id={`${row.key}-brand`}
                value={row.brand}
                onChange={(e) => updateRow(row.key, { brand: e.target.value })}
                placeholder="Brand"
                className={`${inputClass} w-[110px] shrink-0`}
              />
              <label htmlFor={`${row.key}-product`} className="sr-only">
                Product
              </label>
              <input
                id={`${row.key}-product`}
                value={row.product}
                onChange={(e) => updateRow(row.key, { product: e.target.value })}
                placeholder="Product"
                className="ctl !py-2 max-w-none min-w-[150px] flex-1"
              />
              <label htmlFor={`${row.key}-part`} className="sr-only">
                Part number
              </label>
              <input
                id={`${row.key}-part`}
                value={row.part_number}
                onChange={(e) => updateRow(row.key, { part_number: e.target.value })}
                placeholder="Part no."
                className={`${inputClass} w-[110px] shrink-0`}
              />
              <label htmlFor={`${row.key}-category`} className="sr-only">
                Category
              </label>
              <select
                id={`${row.key}-category`}
                value={row.category ?? ""}
                onChange={(e) =>
                  updateRow(row.key, { category: (e.target.value || null) as ModCategory | null })
                }
                className="ctl !py-2 w-[130px] shrink-0"
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
                  className="chip chip--live shrink-0"
                  title="Low-confidence parse — check this line before saving"
                >
                  Check this
                </span>
              )}
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
                className="shrink-0 px-1 text-dim transition hover:text-live"
                aria-label="Remove mod"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
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
        <div className="flex items-center gap-3">
          {status && (
            <span className={`chip ${status === "Saved." ? "chip--ok" : "chip--live"}`}>{status}</span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="btn btn--live"
          >
            {pending ? "Saving…" : "Save the build"}
          </button>
        </div>
      </div>
    </section>
  );
}
