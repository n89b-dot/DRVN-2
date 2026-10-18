"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { ActionFooter, Button, Checkbox, TextField, TileHead } from "@/components/ui";
import type { ModItem, ModOrigin, ModStatus } from "@/lib/database.types";
import { useHydrated } from "@/lib/hooks/useHydrated";
import {
  isLowConfidence,
  MOD_CATEGORIES,
  MOD_GROUPS,
  parsePasteText,
  type ModCategory,
} from "@/lib/mods/parse";
import { modTypeByKey, modTypeFor, PICK_LIST, stockLineLabel, type ModType } from "@/lib/mods/stock-parts";

import { unlinkModListing } from "@/app/(product)/sell/actions";

import { readPartLink, saveModItems, type ModItemInput } from "../../actions";
import { useUnsavedGuard } from "./use-unsaved";

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
  /** That listing's own status (draft, active, reserved, sold…) — the chip
   *  says what the listing really is, not "For sale" for any link. */
  linked_status: string | null;
  /**
   * Whether the part is still on the car (A-2). A removed row stays in the
   * sheet and stays in the payload — that is what keeps its id, and what lets
   * the public build sheet go on naming it under "came off this car".
   * Dropping the row from this array is the one gesture that really deletes.
   */
  status: ModStatus;
  /** Set by the database when the part came off; display only. */
  removed_at: string | null;
  /** Link-added parts (L-1…L-4). Carried through every save: these columns
   *  are in save_mod_items' column lists, so not sending them clears them. */
  product_url: string | null;
  image_url: string | null;
  source_domain: string | null;
  ref_price_cents: number | null;
  ref_price_currency: string | null;
  /** Came from a DRVN purchase (C-1). Like a listed line, it can be taken
   *  off the car but not deleted — the save keeps it either way. */
  bought: boolean;
  /** aftermarket, or stock: a factory part that came off when a mod went on. */
  origin: ModOrigin;
  /** Brand and product as loaded, so typing over a listed part can be told
   *  apart from fixing a typo in it. */
  loadedLabel: string;
};

function blankRow(group_label = "Other"): Row {
  return {
    key: crypto.randomUUID(),
    id: null,
    group_label,
    brand: "",
    product: "",
    part_number: "",
    category: null,
    confidence: null,
    raw_text: "",
    linked_listing_id: null,
    linked_status: null,
    status: "installed",
    removed_at: null,
    product_url: null,
    image_url: null,
    source_domain: null,
    ref_price_cents: null,
    ref_price_currency: null,
    bought: false,
    origin: "aftermarket",
    loadedLabel: "",
  };
}

/** A line with nothing typed and nothing attached — never worth saving. */
function isEmptyRow(row: Row): boolean {
  return (
    !row.id &&
    !row.brand.trim() &&
    !row.product.trim() &&
    !row.part_number.trim() &&
    !row.raw_text.trim() &&
    !row.product_url &&
    !row.linked_listing_id &&
    !row.bought
  );
}

/** A linked line's chip and where it leads: the listing's real state. A
 *  draft opens its editor — it has no public page to show yet. */
function linkedListingChip(row: Pick<Row, "linked_listing_id" | "linked_status">) {
  const status = row.linked_status;
  const label =
    status === "active"
      ? "For sale"
      : status
        ? status.charAt(0).toUpperCase() + status.slice(1)
        : "Listed";
  return {
    label,
    className: `chip ${status === "active" ? "chip--ok" : status === "reserved" ? "chip--live" : "chip--spent"} !static`,
    href:
      status === "draft"
        ? `/listings/${row.linked_listing_id}/edit`
        : `/listings/${row.linked_listing_id}`,
  };
}

/** What a row is called in prose — for the removal prompt and the record. */
function rowLabel(row: Pick<Row, "brand" | "product" | "raw_text">): string {
  return [row.brand, row.product].filter(Boolean).join(" ").trim() || row.raw_text.trim() || "this part";
}

/**
 * Heuristic paste parser (PRD §7.3 — the AI parse is the later upgrade path).
 * Lines that look like group headers ("Performance:", "EXTERIOR") set the
 * current group; other non-empty lines become items with a brand (curated
 * multi-word list, falling back to first-word), inferred category, extracted
 * part number, and a confidence score the UI uses to flag rows worth a
 * second look.
 */
function parsePaste(text: string): Row[] {
  return parsePasteText(text).map((r) => ({ ...blankRow(), ...r }));
}

const inputClass = "ctl";

/** What a save would send, as one comparable string — the dirty check. */
function snapshot(rows: Row[]): string {
  return JSON.stringify(
    rows.map((r) => [
      r.id ?? r.key,
      r.group_label,
      r.brand.trim(),
      r.product.trim(),
      r.part_number.trim(),
      r.category,
      r.status,
      r.product_url,
      r.origin,
    ])
  );
}

export function ModsEditor({
  carId,
  carMake,
  initialMods,
}: {
  carId: string;
  /** The brand a stock part is listed under. */
  carMake: string | null;
  /** `linked_listing` is the linked listing's status, embedded by the caller. */
  initialMods: (ModItem & { linked_listing?: { status: string } | null })[];
}) {
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
      linked_status: m.linked_listing?.status ?? null,
      status: m.status,
      removed_at: m.removed_at,
      bought: Boolean(m.source_order_item_id),
      origin: m.origin ?? "aftermarket",
      loadedLabel: `${m.brand ?? ""} ${m.product ?? ""}`.trim().toLowerCase(),
      product_url: m.product_url,
      image_url: m.image_url,
      source_domain: m.source_domain,
      ref_price_cents: m.ref_price_cents,
      ref_price_currency: m.ref_price_currency,
    }))
  );
  // Controlled fields must not replace what was typed before hydration
  // (see useHydrated): they stay disabled until the page is live.
  const ready = useHydrated();
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  // L-1: "Add mod" opens on a link. Typing stays first-class — the manual
  // row is one click away and a failed fetch falls back to it — but pasting
  // the shop page you just bought from is the fastest true thing to do.
  const [link, setLink] = useState("");
  const [linkPending, setLinkPending] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const [unlinkPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // Saves call the action in their own transition, so a redirect it already
  // followed — the sign-in redirect when the session has ended, for one —
  // lands in Next's redirect boundary instead of being followed a second time.
  const [, startSave] = useTransition();
  const pending = saving || unlinkPending;
  const [unlinkingKey, setUnlinkingKey] = useState<string | null>(null);
  // Passive post-save affordance (brief §W1): when a save meaningfully changed
  // the build, one quiet inline line offers to turn it into an update. Never a
  // modal, never repeated — dismissing it (or saving again without changes)
  // clears it, and ignoring it costs nothing.
  const [suggestion, setSuggestion] = useState<{ added: string[]; removed: string[] } | null>(null);
  // A-1's inline ask. One row at a time: "What happens to the old part?" is a
  // question about a specific line, and two open at once would be a dialog
  // pretending to be a row.
  const [asking, setAsking] = useState<string | null>(null);
  const router = useRouter();
  // Dirty = differs from what was last loaded or saved. Marked beside Save,
  // and leaving the page while dirty asks first (the page has other Saves).
  const [savedSnap, setSavedSnap] = useState(() => snapshot(rows));
  const dirty = snapshot(rows) !== savedSnap;
  useUnsavedGuard(dirty);
  // Phones fold every saved line to a one-row summary (five labelled fields
  // per line made a five-part build 2,400px long); tapping one opens it.
  // New, parsed and flagged lines always open unfolded.
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());
  const openRow = (key: string) => setOpenKeys((k) => new Set(k).add(key));
  // Replace moves the old part to "Came off this car" and leaves a blank line
  // where it was. Said out loud, with an undo, so it doesn't read as the
  // part's details vanishing.
  const [replaced, setReplaced] = useState<{ newKey: string; oldKey: string; label: string } | null>(
    null
  );
  useEffect(() => {
    if (replaced) document.getElementById(`${replaced.newKey}-brand`)?.focus();
  }, [replaced]);
  // "What came off": asked once per new mod, inline under its line. A line
  // leaves the question behind when it's answered, dismissed or saved (a
  // saved line has an id, and only unsaved lines ask). Lines made by Replace
  // never ask — what came off there is the part they replaced.
  const [stockClosed, setStockClosed] = useState<Set<string>>(() => new Set());
  const [replacementKeys, setReplacementKeys] = useState<Set<string>>(() => new Set());
  const [stockPick, setStockPick] = useState<Record<string, string>>({});
  const closeStock = (key: string) => setStockClosed((k) => new Set(k).add(key));
  const stockLabels = new Set(
    rows.filter((r) => r.origin === "stock").map((r) => r.product.trim().toLowerCase())
  );
  /** The stock parts a new line might have replaced, minus ones already on the sheet. */
  function stockOfferFor(row: Row): { type: ModType | null; parts: string[] } | null {
    if (row.id || row.status !== "installed" || row.origin !== "aftermarket") return null;
    if (stockClosed.has(row.key) || replacementKeys.has(row.key)) return null;
    const name = `${row.brand} ${row.product}`.trim() || row.raw_text.trim();
    if (!name) return null;
    const type = (stockPick[row.key] ? modTypeByKey(stockPick[row.key]) : null) ?? modTypeFor(name);
    if (!type) return { type: null, parts: [] };
    const parts = type.stock.map(stockLineLabel).filter((l) => !stockLabels.has(l.toLowerCase()));
    return parts.length ? { type, parts } : null;
  }
  /** Ticked stock parts become removed lines, each with List it. */
  function addStockParts(row: Row, type: ModType, labels: string[]) {
    const lines = labels.map((label) => ({
      ...blankRow(row.group_label),
      brand: carMake ?? "",
      product: label,
      category: type.category,
      raw_text: label,
      status: "removed" as ModStatus,
      origin: "stock" as ModOrigin,
    }));
    setRows((r) => [...r, ...lines]);
    closeStock(row.key);
  }

  const installed = rows.filter((r) => r.status === "installed");
  const cameOff = rows.filter((r) => r.status === "removed");

  /** Remove: the row keeps its id and its place in the payload (A-2). */
  function markRemoved(key: string) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, status: "removed" as ModStatus } : row)));
    setAsking(null);
  }

  /** Put a part back on the car — the same gesture, undone. */
  function markInstalled(key: string) {
    setRows((r) =>
      r.map((row) =>
        row.key === key ? { ...row, status: "installed" as ModStatus, removed_at: null } : row
      )
    );
  }

  /**
   * Replace is its own action because people were typing over rows, which
   * silently rewrote history: the listing released from that line, and every
   * past update naming it, ended up describing the new part. The old row is
   * marked removed and keeps its id; a fresh row takes its position.
   */
  function replaceRow(key: string) {
    const index = rows.findIndex((row) => row.key === key);
    if (index < 0) return;
    const old = rows[index];
    const fresh = blankRow(old.group_label);
    const next = [...rows];
    next[index] = { ...old, status: "removed" as ModStatus };
    next.splice(index, 0, fresh);
    setRows(next);
    setReplacementKeys((k) => new Set(k).add(fresh.key));
    setAsking(null);
    setReplaced({ newKey: fresh.key, oldKey: old.key, label: rowLabel(old) });
  }

  /** Replace, undone: the blank line goes and the old part is back on. */
  function undoReplace() {
    if (!replaced) return;
    const { newKey, oldKey } = replaced;
    setRows((r) =>
      r
        .filter((row) => row.key !== newKey)
        .map((row) => (row.key === oldKey ? { ...row, status: "installed" as ModStatus } : row))
    );
    setReplaced(null);
  }

  /** The only true delete: drop the line, and save_mod_items removes it. */
  function deleteRow(key: string) {
    setRows((r) => r.filter((row) => row.key !== key));
    setAsking(null);
  }

  /**
   * A-4 / contract 3: commit the sheet, THEN open the sell form. Navigating
   * first meant an abandoned form lost the removal as well as the listing;
   * committing first leaves the part under "Came off this car" either way.
   * A row that already has a listing opens that listing instead.
   */
  async function listIt(row: Row) {
    if (row.linked_listing_id) {
      router.push(linkedListingChip(row).href);
      return;
    }
    const nextRows = rows.map((r) =>
      r.key === row.key ? { ...r, status: "removed" as ModStatus } : r
    );
    setRows(nextRows);
    setAsking(null);
    const saved = await persist(nextRows);
    if (!saved) return;
    router.push(`/sell?car=${carId}&mod=${row.id ?? row.key}`);
  }

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
        updateRow(row.key, { linked_listing_id: null, linked_status: null });
      }
      setUnlinkingKey(null);
    });
  }

  async function addFromLink() {
    const url = link.trim();
    if (!url || linkPending) return;
    setLinkPending(true);
    setLinkError(null);
    try {
      const result = await readPartLink(url);
      if (!result.ok) {
        setLinkError(result.error);
        return;
      }
      const p = result.part;
      setRows((r) => [
        ...r,
        {
          ...blankRow(),
          brand: p.brand ?? "",
          product: p.product ?? p.title,
          part_number: p.part_number ?? "",
          category: p.category,
          raw_text: p.title,
          product_url: p.product_url,
          image_url: p.image_url,
          source_domain: p.source_domain,
          ref_price_cents: p.ref_price_cents,
          ref_price_currency: p.ref_price_currency,
        },
      ]);
      setLink("");
    } catch {
      setLinkError("Couldn't read that link. You can type the part in instead.");
    } finally {
      setLinkPending(false);
    }
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  /**
   * The one commit path. `save()` is the button; `listIt()` calls it too,
   * because the sheet has to be on disk before the sell form opens. Takes the
   * rows explicitly so a caller that just changed them doesn't have to wait
   * for React to hand the new state back.
   */
  function persist(rowsToSave: Row[]): Promise<boolean> {
    if (savingRef.current || unlinkPending) return Promise.resolve(false);
    savingRef.current = true;
    setSaving(true);
    setStatus(null);
    // A line with nothing in it (a Replace or "+ Add a line" left blank) is
    // dropped rather than saved as a nameless part.
    const dropped = new Set(rowsToSave.filter(isEmptyRow).map((r) => r.key));
    const kept = rowsToSave.filter((r) => !dropped.has(r.key));
    const items: ModItemInput[] = kept.map((r, i) => ({
      id: r.id ?? r.key,
      group_label: r.group_label,
      brand: r.brand.trim() || null,
      product: r.product.trim() || null,
      part_number: r.part_number.trim() || null,
      category: r.category,
      confidence: r.confidence,
      raw_text: r.raw_text || `${r.brand} ${r.product}`.trim(),
      position: i,
      status: r.status,
      product_url: r.product_url,
      image_url: r.image_url,
      source_domain: r.source_domain,
      ref_price_cents: r.ref_price_cents,
      ref_price_currency: r.ref_price_currency,
      origin: r.origin,
    }));
    // Only the call runs in the transition: `saving` and the cleared status
    // above stay urgent, so the button is disabled before a second click.
    const commit = async (): Promise<boolean> => {
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
          return false;
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
          // A part that just came off gets its date now, so the row reads
          // "Off since …" instead of still promising to come off.
          const today = new Date().toISOString();
          setRows((current) =>
            current
              .filter((row) => !dropped.has(row.key))
              .map((row) => ({
                ...row,
                id: row.id ?? row.key,
                removed_at: row.status === "removed" ? (row.removed_at ?? today) : row.removed_at,
              }))
          );
          setSavedSnap(snapshot(kept));
          setReplaced(null);
          const label = (row: { brand?: string | null; product?: string | null; raw_text?: string | null }) =>
            [row.brand, row.product].filter(Boolean).join(" ").trim() || (row.raw_text ?? "").trim();
          // "What changed" is now a question about state, not about presence: a
          // part that came off is still in the sheet, so comparing the two sets
          // of labels would report nothing removed.
          const before = new Set(
            initialMods.filter((m) => m.status === "installed").map((m) => label(m)).filter(Boolean)
          );
          const after = new Set(
            kept.filter((r) => r.status === "installed").map((r) => label(r)).filter(Boolean)
          );
          const added = [...after].filter((l) => !before.has(l)).slice(0, 3);
          const removed = [...before].filter((l) => !after.has(l)).slice(0, 3);
          setSuggestion(added.length || removed.length ? { added, removed } : null);
        }
        return !result.error;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    };
    return new Promise((resolve) => {
      startSave(async () => {
        let saved = false;
        try {
          saved = await commit();
        } finally {
          resolve(saved);
        }
      });
    });
  }

  const save = () => persist(rows);

  return (
    <section className="tile">
      <fieldset disabled={!ready} className="contents">
      <div className="tile__head">
        <span className="microlabel microlabel--ink">The build — seed the lines</span>
        <Button variant="ghost" onClick={() => setShowPaste((s) => !s)}>
          Paste a list
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <TextField
          id="mods-link"
          label="Paste a product link"
          type="url"
          inputMode="url"
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            if (linkError) setLinkError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void addFromLink();
            }
          }}
          placeholder="https://shop.example.com/the-part-you-fitted"
          error={linkError ?? undefined}
          fieldClassName="!mb-0 min-w-0 flex-1 basis-[280px]"
          className="max-w-none"
        />
        {/* Level with the input (the hint moved below the row, where it used
            to push the button 40px under the field it acts on), and never a
            dead grey slab: empty, it says what it needs. */}
        <Button
          variant="ghost"
          onClick={() => {
            if (!link.trim()) {
              setLinkError("Paste a product link first.");
              document.getElementById("mods-link")?.focus();
              return;
            }
            void addFromLink();
          }}
          loading={linkPending}
          pendingLabel="Reading…"
          aria-disabled={!link.trim() || undefined}
        >
          Add from link
        </Button>
      </div>
      <p className="field__hint mt-2">
        Fills in the title, brand, part number, photo and what the shop was charging. Everything
        stays editable, and typing it in yourself works just as well.
      </p>

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

      {installed.length > 0 && (
        /* Phones close the gap to zero: each record already separates itself
           with its own top rule, and 8px on top of that reads as a stray band
           between lines rather than as a ruled sheet. */
        <div className="mt-4 flex flex-col gap-2 max-sm:gap-0">
          <p className="field__hint">Confirm or edit the parsed lines before saving.</p>
          {/* Desktop column captions. The trailing controls are mirrored,
              invisibly, so the flexible Product column lines up with the
              rows below it. Phones caption each field instead. */}
          <div className="modrow modrow--cols" aria-hidden="true">
            <span className="modrow__col modrow__col--group">Group</span>
            <span className="modrow__col modrow__col--short">Brand</span>
            <span className="modrow__col modrow__col--grow">Product</span>
            <span className="modrow__col modrow__col--short">Part no.</span>
            <span className="modrow__col modrow__col--cat">Category</span>
            <span className="invisible microlabel shrink-0">Replace</span>
            <span className="invisible modrow__rm shrink-0 px-1">✕</span>
          </div>
          {installed.map((row, index) => {
            const flagged = row.confidence !== null && isLowConfidence(row.confidence);
            const retyped =
              Boolean(row.linked_listing_id) &&
              `${row.brand} ${row.product}`.trim().toLowerCase() !== row.loadedLabel;
            const folded =
              Boolean(row.id) &&
              !openKeys.has(row.key) &&
              asking !== row.key &&
              !flagged &&
              !retyped &&
              replaced?.newKey !== row.key;
            return (
            /* Desktop: a ledger line. Phone: a labelled record — see `.modrow`
               in globals.css. The head/foot wrappers are `display: contents`
               on desktop, so this is one set of controls at both widths, not
               two rendered copies of the same state. */
            <div key={row.key} className={folded ? "modrow modrow--folded" : "modrow"}>
              {folded && (
                /* Phone-only: the folded line. Hidden on desktop, where the
                   ledger line is already one row. */
                <button
                  type="button"
                  className="modrow__sum"
                  onClick={() => openRow(row.key)}
                  aria-label={`Edit ${rowLabel(row)}`}
                >
                  <span className="modrow__n">{String(index + 1).padStart(2, "0")}</span>
                  <span className="modrow__sumtext">
                    <span className="modrow__sumname">{rowLabel(row)}</span>
                    <span className="modrow__sumgroup">
                      {row.group_label}
                      {row.linked_listing_id ? " · For sale" : ""}
                    </span>
                  </span>
                  <span aria-hidden="true" className="modrow__sumgo">
                    ›
                  </span>
                </button>
              )}
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
                  className="ctl min-w-0 flex-1 sm:w-[160px] sm:flex-none"
                >
                  {/* A parsed group outside the list (e.g. "Brakes") must
                      still show as itself — otherwise the select silently
                      displays the first option instead. */}
                  {!(MOD_GROUPS as readonly string[]).includes(row.group_label) && row.group_label && (
                    <option>{row.group_label}</option>
                  )}
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
              {flagged && (
                <span
                  className="chip chip--live mt-2 shrink-0 self-start sm:mt-0 sm:self-auto"
                  title="Low-confidence parse — check this line before saving"
                >
                  Check this
                </span>
              )}
              <span className="modrow__foot">
                {row.linked_listing_id && (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Link
                      href={linkedListingChip(row).href}
                      className={linkedListingChip(row).className}
                      title="See the listing this line released"
                    >
                      {linkedListingChip(row).label}
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
                )}
                {/* Replace is offered on every line, including an unfiled one:
                    it is an editing gesture, not a release. */}
                <button
                  type="button"
                  onClick={() => replaceRow(row.key)}
                  className="microlabel shrink-0 py-3 underline decoration-dotted transition hover:text-live"
                  title="The old part comes off and keeps its record; a new line takes its place"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => setAsking(asking === row.key ? null : row.key)}
                  className="modrow__rm shrink-0 px-1"
                  aria-expanded={asking === row.key}
                  aria-label={`Take ${rowLabel(row)} off this car`}
                >
                  <span aria-hidden="true">✕</span>
                  <span className="modrow__rmtext" aria-hidden="true">
                    Remove
                  </span>
                </button>
              </span>
              {retyped && (
                  /* A-2. This line is what a live listing says it came from,
                     so typing a different part over it rewrites the listing's
                     provenance. A typo fix is fine; a swap wants Replace. */
                  <span className="modrow__via" role="status">
                    <span className="microlabel">
                      This part is listed for sale. Fixing a typo is fine — if it&rsquo;s a different
                      part now, use{" "}
                      <button
                        type="button"
                        onClick={() => replaceRow(row.key)}
                        className="underline decoration-dotted transition hover:text-live"
                      >
                        Replace
                      </button>{" "}
                      so the listing keeps pointing at the right one.
                    </span>
                  </span>
                )}
              {(row.source_domain || row.ref_price_cents !== null) && (
                /* What the link gave us, stated plainly so the owner can see
                   it was captured — and correct it if the shop lied. */
                <span className="modrow__via">
                  {row.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.image_url} alt="" className="modrow__thumb" />
                  )}
                  {row.product_url ? (
                    <a href={row.product_url} target="_blank" rel="nofollow noreferrer" className="jumplink">
                      via {row.source_domain ?? "the shop"} →
                    </a>
                  ) : (
                    <span className="microlabel">via {row.source_domain}</span>
                  )}
                  {row.ref_price_cents !== null && row.ref_price_currency && (
                    <span className="microlabel">
                      listed at{" "}
                      {new Intl.NumberFormat("en", {
                        style: "currency",
                        currency: row.ref_price_currency,
                      }).format(row.ref_price_cents / 100)}
                    </span>
                  )}
                </span>
              )}
              {asking === row.key && (
                /* A-1. Asked inline, in the row, because the answer is about
                   this part and nothing else. Neither answer loses the record:
                   "Just remove it" still keeps the line under "Came off this
                   car". Delete is only offered where it can't orphan a
                   listing. */
                <div className="modrow__ask" role="group" aria-label={`What happens to ${rowLabel(row)}?`}>
                  <span className="microlabel">What happens to the old part?</span>
                  <Button
                    variant="ghost"
                    onClick={() => listIt(row)}
                    disabled={pending}
                    title="Save the sheet, then open the sell form with this part filled in"
                  >
                    List it
                  </Button>
                  <Button variant="ghost" onClick={() => markRemoved(row.key)} disabled={pending}>
                    Just remove it
                  </Button>
                  {!row.linked_listing_id && !row.bought && (
                    <button
                      type="button"
                      onClick={() => deleteRow(row.key)}
                      className="microlabel shrink-0 py-3 underline decoration-dotted transition hover:text-live"
                      title="This line was never on the car — delete it outright"
                    >
                      Delete — added by mistake
                    </button>
                  )}
                </div>
              )}
              {replaced?.newKey === row.key && (
                <span className="modrow__via" role="status">
                  <span className="microlabel">
                    {replaced.label} moved to Came off this car ·{" "}
                    <button
                      type="button"
                      onClick={undoReplace}
                      className="underline decoration-dotted transition hover:text-live"
                    >
                      Undo
                    </button>
                  </span>
                </span>
              )}
              {(() => {
                const offer = stockOfferFor(row);
                if (!offer) return null;
                return (
                  <StockOffer
                    key={offer.type?.key ?? "pick"}
                    rowKey={row.key}
                    label={rowLabel(row)}
                    type={offer.type}
                    parts={offer.parts}
                    onPick={(key) => setStockPick((p) => ({ ...p, [row.key]: key }))}
                    onAdd={(labels) => offer.type && addStockParts(row, offer.type, labels)}
                    onClose={() => closeStock(row.key)}
                  />
                );
              })()}
            </div>
            );
          })}
        </div>
      )}

      {cameOff.length > 0 && (
        /* A-2. Removal is a state, so the parts that came off are still on the
           sheet — listed, not hidden. Each one can still be sold, put back, or
           (only where nothing points at it) deleted outright. */
        <div className="mt-6">
          <TileHead
            label="Came off this car"
            end={
              <span className="microlabel">
                {cameOff.length} part{cameOff.length === 1 ? "" : "s"}
              </span>
            }
          />
          <div className="mt-2 flex flex-col gap-2 max-sm:gap-0">
            {cameOff.map((row) => (
              <div key={row.key} className="modrow modrow--off">
                <span className="modrow__head">
                  <span className="modrow__n" aria-hidden="true">
                    ✕
                  </span>
                  <span className="text-body font-medium">{rowLabel(row)}</span>
                </span>
                <span className="microlabel shrink-0">
                  {row.origin === "stock" && "Stock · "}
                  {row.removed_at
                    ? `Off since ${new Date(row.removed_at).toLocaleDateString()}`
                    : "Coming off when you save"}
                </span>
                <span className="modrow__foot">
                  {row.linked_listing_id ? (
                    <Link
                      href={linkedListingChip(row).href}
                      className={linkedListingChip(row).className}
                      title="See the listing this part was released to"
                    >
                      {linkedListingChip(row).label}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => listIt(row)}
                      disabled={pending}
                      className="relbtn !static shrink-0 disabled:opacity-50"
                      title="List this part for sale with its provenance attached"
                    >
                      List it
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => markInstalled(row.key)}
                    className="microlabel shrink-0 py-3 underline decoration-dotted transition hover:text-live"
                    title="Put this part back on the car"
                  >
                    Put it back
                  </button>
                  {!row.linked_listing_id && !row.bought && (
                    <button
                      type="button"
                      onClick={() => deleteRow(row.key)}
                      className="modrow__rm shrink-0 px-1"
                      aria-label={`Delete the record of ${rowLabel(row)}`}
                    >
                      <span aria-hidden="true">✕</span>
                      <span className="modrow__rmtext" aria-hidden="true">
                        Delete
                      </span>
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ActionFooter
        aux={
          <button
            type="button"
            onClick={() => setRows((r) => [...r, blankRow()])}
            className="jumplink"
          >
            + Add a line manually
          </button>
        }
        // "Saved ✓" stops being true the moment the sheet changes again.
        status={status && !(dirty && status.kind === "ok") ? { kind: status.kind, message: status.message } : null}
      >
        {dirty && !pending && (
          <span className="microlabel" role="status">
            Unsaved changes
          </span>
        )}
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
      </fieldset>
    </section>
  );
}

/**
 * "What came off", asked under a new line: tick the stock parts it replaced,
 * or say nothing did. When the name doesn't say what kind of part it is, a
 * short pick list asks first. Nothing is added until the owner ticks.
 */
function StockOffer({
  rowKey,
  label,
  type,
  parts,
  onPick,
  onAdd,
  onClose,
}: {
  rowKey: string;
  label: string;
  type: ModType | null;
  parts: string[];
  onPick: (typeKey: string) => void;
  onAdd: (labels: string[]) => void;
  onClose: () => void;
}) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  return (
    <div className="modrow__ask" role="group" aria-label={`Did stock parts come off for ${label}?`}>
      {type ? (
        <>
          <span className="microlabel">Did stock parts come off?</span>
          {parts.map((part, i) => (
            <Checkbox
              key={part}
              id={`${rowKey}-stock-${i}`}
              label={part}
              checked={ticked.has(part)}
              onChange={(e) =>
                setTicked((t) => {
                  const next = new Set(t);
                  if (e.target.checked) next.add(part);
                  else next.delete(part);
                  return next;
                })
              }
            />
          ))}
          <Button variant="ghost" onClick={() => onAdd(parts.filter((p) => ticked.has(p)))} disabled={!ticked.size}>
            Add to Came off
          </Button>
        </>
      ) : (
        <>
          <span className="microlabel">Did it replace stock parts? What is it?</span>
          {PICK_LIST.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onPick(t.key)}
              className="microlabel shrink-0 py-3 underline decoration-dotted transition hover:text-live"
            >
              {t.label}
            </button>
          ))}
        </>
      )}
      <button
        type="button"
        onClick={onClose}
        className="microlabel shrink-0 py-3 underline decoration-dotted transition hover:text-live"
      >
        Nothing came off
      </button>
    </div>
  );
}
