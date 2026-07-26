"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import type { ModItem } from "@/lib/database.types";

import { saveModItems, type ModItemInput } from "../../actions";

export const MOD_GROUPS = [
  "Performance",
  "Suspension",
  "Exterior",
  "Interior",
  "Wheels & Tires",
  "Other",
] as const;

type Row = {
  key: string;
  /** The saved mod_items id, or null for a line not yet filed. Only a saved
   *  line can be released for sale — the listing links back to this id. */
  id: string | null;
  group_label: string;
  brand: string;
  product: string;
  part_number: string;
  raw_text: string;
};

/**
 * Heuristic paste parser (PRD §7.3 — the AI parse is the later upgrade path).
 * Lines that look like group headers ("Performance:", "EXTERIOR") set the
 * current group; other non-empty lines become items with brand = first word.
 */
function parsePaste(text: string): Row[] {
  const rows: Row[] = [];
  let currentGroup = "Other";

  for (const rawLine of text.split("\n")) {
    // Strip list bullets ("-", "•", "1.", "2)") but not numeric brands like "034".
    const line = rawLine.replace(/^\s*(?:[-•*]+|\d{1,2}[.)])\s+/, "").trim();
    if (!line) continue;

    const headerCandidate = line.replace(/[:\-–]+$/, "").trim();
    const matchedGroup = MOD_GROUPS.find(
      (g) => g.toLowerCase() === headerCandidate.toLowerCase()
    );
    if (matchedGroup && headerCandidate.length === line.replace(/[:\-–]+$/, "").trim().length && line.length < 30) {
      currentGroup = matchedGroup;
      continue;
    }

    const words = line.split(/\s+/);
    rows.push({
      key: crypto.randomUUID(),
      id: null,
      part_number: "",
      group_label: currentGroup,
      brand: words.length > 1 ? words[0] : "",
      product: words.length > 1 ? words.slice(1).join(" ") : line,
      raw_text: line,
    });
  }
  return rows;
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
      raw_text: m.raw_text ?? "",
    }))
  );
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(initialMods.length === 0);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
          <textarea
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
              <select
                value={row.group_label}
                onChange={(e) => updateRow(row.key, { group_label: e.target.value })}
                className="ctl !py-2 w-[130px] shrink-0"
              >
                {MOD_GROUPS.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
              <input
                value={row.brand}
                onChange={(e) => updateRow(row.key, { brand: e.target.value })}
                placeholder="Brand"
                className={`${inputClass} w-[110px] shrink-0`}
              />
              <input
                value={row.product}
                onChange={(e) => updateRow(row.key, { product: e.target.value })}
                placeholder="Product"
                className="ctl !py-2 max-w-none min-w-[150px] flex-1"
              />
              <input
                value={row.part_number}
                onChange={(e) => updateRow(row.key, { part_number: e.target.value })}
                placeholder="Part no."
                className={`${inputClass} w-[110px] shrink-0`}
              />
              {/* Release is only offered on a filed line: the listing links back
                  to this row's id, so an unsaved row has nothing to attach to. */}
              {row.id ? (
                <Link
                  href={`/sell?car=${carId}&mod=${row.id}`}
                  className="relbtn !static shrink-0"
                  title="List this component for sale with its provenance attached"
                >
                  Release
                </Link>
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
                raw_text: "",
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
