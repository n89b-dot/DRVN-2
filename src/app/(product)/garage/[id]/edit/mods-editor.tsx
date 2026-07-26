"use client";

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
  group_label: string;
  brand: string;
  product: string;
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
      group_label: currentGroup,
      brand: words.length > 1 ? words[0] : "",
      product: words.length > 1 ? words.slice(1).join(" ") : line,
      raw_text: line,
    });
  }
  return rows;
}

const inputClass =
  "h-9 w-full rounded-input border border-border bg-app px-2.5 text-sm text-text-primary outline-none focus:border-accent";

export function ModsEditor({ carId, initialMods }: { carId: string; initialMods: ModItem[] }) {
  const [rows, setRows] = useState<Row[]>(
    initialMods.map((m) => ({
      key: m.id,
      group_label: m.group_label,
      brand: m.brand ?? "",
      product: m.product ?? "",
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
      group_label: r.group_label,
      brand: r.brand.trim() || null,
      product: r.product.trim() || null,
      raw_text: r.raw_text || `${r.brand} ${r.product}`.trim(),
      position: i,
    }));
    startTransition(async () => {
      const result = await saveModItems(carId, items);
      setStatus(result.error ?? "Saved.");
    });
  }

  return (
    <section className="rounded-card border border-border bg-surface p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-text-primary">Modifications</h2>
        <button
          type="button"
          onClick={() => setShowPaste((s) => !s)}
          className="rounded-pill border border-border px-4 py-2 text-sm text-text-secondary transition hover:text-text-primary"
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
            className="w-full resize-y rounded-input border border-border bg-app px-3 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
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
              className="rounded-pill bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent/90"
            >
              Parse into items
            </button>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-xs text-text-muted">
            Confirm or edit the parsed items before saving.
          </p>
          {rows.map((row) => (
            <div key={row.key} className="flex flex-wrap items-center gap-2">
              <select
                value={row.group_label}
                onChange={(e) => updateRow(row.key, { group_label: e.target.value })}
                className="h-9 w-[130px] shrink-0 rounded-input border border-border bg-app px-2 text-sm text-text-secondary outline-none focus:border-accent"
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
                className="h-9 min-w-[150px] flex-1 rounded-input border border-border bg-app px-2.5 text-sm text-text-primary outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => setRows((r) => r.filter((x) => x.key !== row.key))}
                className="shrink-0 px-1 text-text-muted transition hover:text-red-400"
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
              { key: crypto.randomUUID(), group_label: "Other", brand: "", product: "", raw_text: "" },
            ])
          }
          className="text-sm text-accent hover:underline"
        >
          + Add item manually
        </button>
        <div className="flex items-center gap-3">
          {status && (
            <span className={`text-sm ${status === "Saved." ? "text-success" : "text-red-400"}`}>
              {status}
            </span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-pill bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90"
          >
            {pending ? "Saving…" : "Save mods"}
          </button>
        </div>
      </div>
    </section>
  );
}
