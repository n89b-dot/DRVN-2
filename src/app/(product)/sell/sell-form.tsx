"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";

import { AnimatePresence, motion } from "motion/react";

import {
  ActionFooter,
  Button,
  Checkbox,
  DropZone,
  FormSection,
  Media,
  MobileActionBar,
  Radio,
  Select,
  TextArea,
  TextField,
  ValidationSummary,
} from "@/components/ui";
import { expand } from "@/lib/motion";
import { checklistFor, GRADES, type ChecklistAnswer } from "@/lib/marketplace/grading";
import { CATEGORIES, CONDITIONS } from "@/lib/marketplace/taxonomy";
import { useUploadQueue } from "@/lib/use-upload-queue";
import { SortableGrid, SortableItem } from "@/components/ui";
import { deleteStagedIfUnconsumed } from "@/lib/media-staging";
import { isLowConfidence } from "@/lib/mods/parse";

import { createListing, updateListing, type SellState } from "./actions";
import { FitmentPicker, type FitmentRow } from "./fitment-picker";

/** A gallery photo, in save order — index 0 is always the cover. */
export type GalleryImage = { url: string; alt: string | null };

export type ListingDraft = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  subcategory: string | null;
  condition: string | null;
  grade: string | null;
  condition_checklist: Record<string, ChecklistAnswer> | null;
  part_number: string | null;
  brand: string | null;
  part_miles: number | null;
  part_miles_unit: string | null;
  price_cents: number;
  shipping_cents: number;
  /** 0053: 'flat' | 'drvn' | 'pickup_only'. */
  shipping_mode?: "flat" | "drvn" | "pickup_only";
  weight_oz?: number | null;
  length_in?: number | null;
  width_in?: number | null;
  height_in?: number | null;
  offer_floor_cents: number | null;
  allows_collection: boolean;
  location: string | null;
  compatibility_notes: string | null;
  source_car_id: string | null;
  status: string;
  images: GalleryImage[];
  fitments: FitmentRow[];
  /** "Also known as" identifiers (0042) — search matches these too. */
  alt_part_numbers?: string[];
};

/**
 * One normalized initialization contract for every way a listing form starts:
 * blank, Garage/Build → Sell, an imported external listing, or (via `listing`)
 * an existing draft/edit. Values here seed the form once at mount; the form
 * and the server actions stay the single validation authority.
 */
export type SellFormInitialValues = {
  /** Where these values came from — drives contextual copy only. */
  origin: "garage" | "import";
  carId?: string;
  title?: string;
  category?: string;
  subcategory?: string;
  condition?: string;
  description?: string;
  partNumber?: string;
  brand?: string;
  /** Dollar strings ("450.00"), matching the form's money inputs. */
  price?: string;
  shipping?: string;
  allowsCollection?: boolean;
  location?: string;
  compatibilityNotes?: string;
  /** Photos already in the seller's own DRVN storage (imports re-host first). */
  images?: GalleryImage[];
  fitment?: FitmentRow[];
  modItemId?: string;
  /** Parser confidence carried from the mod line, for the guess note below —
   *  listings have no confidence column, so this never reaches the server. */
  modConfidence?: number | null;
  /** Present when these values came from an imported listing. */
  importReview?: {
    id: string;
    /** "Facebook Marketplace", "golfmk7.com", "your pasted post". */
    sourceLabel: string;
    /** The imported post, for the collapsed "original post" panel. */
    originalText?: string;
    /** Specific check-this reasons, rendered beside the fields they name. */
    issues: { field: string; message: string }[];
  };
};

export function SellForm({
  cars,
  makes,
  userId,
  listing,
  initialValues,
  canPublish = true,
  drvnShipping,
  defaultOfferFloorPct,
}: {
  cars: { id: string; name: string; make?: string | null; model?: string | null; year?: number | null }[];
  /** Canonical make names for the fitment picker's suggestions. */
  makes: string[];
  userId: string;
  /** Payouts ready? When false, publishing is gated (drafts still save) and
   *  the checklist says so up front instead of the server refusing on submit. */
  canPublish?: boolean;
  /** Present when editing an existing listing. */
  listing?: ListingDraft;
  /** Seed values for a fresh listing (Garage → Sell, imported listing). */
  initialValues?: SellFormInitialValues;
  /** DRVN Shipping availability (0053): the flag/provider state plus whether
   *  this seller's ship-from profile is verified. Absent = feature off. */
  drvnShipping?: { enabled: boolean; profileReady: boolean };
  /** P-9: the seller's own floor, as a percentage of the asking price.
   *  Prefills this form and nothing else. */
  defaultOfferFloorPct?: number | null;
}) {
  const prefill = initialValues;
  const importReview = initialValues?.importReview;
  /** The import's specific "check this" note for a field, if any. */
  const issueFor = (field: string): string | undefined =>
    importReview?.issues.find((issue) => issue.field === field)?.message;
  const isEdit = Boolean(listing);
  const [state, setState] = useState<SellState>({});
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [sourceCarId, setSourceCarId] = useState(listing?.source_car_id ?? prefill?.carId ?? "");
  const [category, setCategory] = useState(listing?.category ?? prefill?.category ?? "");
  const [subcategory, setSubcategory] = useState(
    listing?.subcategory ?? prefill?.subcategory ?? ""
  );
  const [condition, setCondition] = useState(listing?.condition ?? prefill?.condition ?? "used");
  const [images, setImages] = useState<GalleryImage[]>(listing?.images ?? prefill?.images ?? []);
  const [shippingMode, setShippingMode] = useState<"flat" | "drvn" | "pickup_only">(
    listing?.shipping_mode ?? "flat"
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** The photo whose alt-text field is open (one at a time). */
  const [editingAlt, setEditingAlt] = useState<string | null>(null);
  // Kept for the lifetime of this form so a retry after a lost Server Action
  // response addresses the same listing creation request.
  const creationRequestId = useRef<string | null>(null);

  const subcategories = CATEGORIES.find((c) => c.slug === category)?.subcategories ?? [];
  const money = (cents: number | null | undefined) =>
    cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);

  // Completeness + validation-summary state. Price/shipping are lifted from
  // uncontrolled defaultValue inputs so the checklist and readiness note can
  // read them live, without re-plumbing the rest of the form.
  const [grade, setGrade] = useState(listing?.grade ?? "");
  // The seller attested this disclosure when the listing was saved with its
  // grade, so an edit that leaves grade and checklist alone doesn't ask
  // again — changing a price used to fail on a checkbox two sections away.
  // Touching the grade or any checklist answer clears it (below).
  const [attestAccurate, setAttestAccurate] = useState(Boolean(listing?.grade));
  const [price, setPrice] = useState(listing ? money(listing.price_cents) : prefill?.price ?? "");
  // P-9: a seller default, applied to the FORM only. The listing keeps its
  // own offer_floor_cents, so changing the setting later never alters what
  // a live listing already accepts — that would be a silent repricing.
  const suggestedFloor =
    defaultOfferFloorPct && price && Number(price) > 0
      ? money(Math.round((Number(price) * 100 * defaultOfferFloorPct) / 100))
      : "";
  const [shipping, setShipping] = useState(
    listing ? money(listing.shipping_cents ?? 0) : prefill?.shipping ?? money(0)
  );
  const [fitmentCount, setFitmentCount] = useState(
    listing?.fitments?.length ?? prefill?.fitment?.length ?? 0
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const usedNeedsGrade = condition !== "new";
  // M-5/W-2: the photo is the unit of the product — a public listing needs
  // at least one. Drafts are exempt; so is editing a listing that isn't live.
  const publishesNow = !isEdit || listing?.status === "active";

  /** Mirrors the server's hard checks that a submitter can see before the
   *  round-trip — anything the server alone can validate (ownership, rate
   *  limits) stays server-side and still surfaces via state.error. */
  function validate(formData: FormData): Record<string, string> {
    const errors: Record<string, string> = {};
    const asDraft = formData.get("save_draft") !== null;
    if (publishesNow && !asDraft && images.length === 0) {
      errors.photos = "Add at least one photo — a listing goes public with its picture.";
    }
    const title = String(formData.get("title") ?? "").trim();
    if (!title) errors.title = "Title is required.";
    else if (title.length > 140) errors.title = "Keep the title under 140 characters.";

    const categoryValue = String(formData.get("category") ?? "");
    if (!categoryValue) errors.category = "Pick a category.";

    const priceRaw = String(formData.get("price") ?? "").trim();
    const priceCents = Math.round(Number(priceRaw) * 100);
    if (!priceRaw || !Number.isFinite(priceCents) || priceCents < 0) {
      errors.price = "Enter a valid price.";
    }

    if (usedNeedsGrade && grade && !attestAccurate) {
      errors.attest_accurate = "Confirm the condition disclosure is accurate before publishing.";
    }

    if (String(formData.get("shipping_mode") ?? "") === "drvn") {
      const dims: [string, string][] = [
        ["weight_oz", "packed weight"],
        ["length_in", "length"],
        ["width_in", "width"],
        ["height_in", "height"],
      ];
      for (const [field, label] of dims) {
        const value = Number(String(formData.get(field) ?? "").trim());
        if (!Number.isFinite(value) || value <= 0) errors[field] = `Enter the ${label}.`;
      }
    }

    return errors;
  }

  const fieldLabels: Record<string, string> = {
    photos: "Photos",
    title: "Title",
    category: "Category",
    price: "Asking price",
    attest_accurate: "Condition disclosure confirmation",
    weight_oz: "Packed weight",
    length_in: "Length",
    width_in: "Width",
    height_in: "Height",
  };
  const fieldAnchors: Record<string, string> = {
    photos: "sell-photos",
    title: "sell-title",
    category: "sell-category",
    price: "sell-price",
    attest_accurate: "sell-attest",
    weight_oz: "sell-weight",
    length_in: "sell-length",
    width_in: "sell-width",
    height_in: "sell-height",
  };

  // Upload queue (§S1): instant local previews, per-image status, retry —
  // three at a time, form editing uninterrupted. §S4 normalization included.
  const queue = useUploadQueue({
    bucket: "listing-images",
    pathPrefix: userId,
    maxBytes: 10 * 1024 * 1024,
    onUploaded: ({ url }) => {
      setImages((u) => (u.some((img) => img.url === url) ? u : [...u, { url, alt: null }]));
    },
  });
  const uploading = queue.uploading;
  const pendingUploads = queue.items.filter((item) => item.status !== "done");

  function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploadError(null);
    queue.addFiles(files);
  }

  /** Reorder is a swap with a neighbour; moving index 0 changes the cover. */
  function moveImage(index: number, direction: -1 | 1) {
    setImages((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  /** Promotes a photo straight to index 0 — the cover slot. */
  function makeCover(index: number) {
    setImages((current) => {
      if (index <= 0 || index >= current.length) return current;
      const next = [...current];
      const [chosen] = next.splice(index, 1);
      next.unshift(chosen);
      return next;
    });
  }

  function removeImage(index: number) {
    // Best-effort storage cleanup for a photo backed out of before saving.
    // The server only deletes when the upload is still staged, unconsumed
    // and unreferenced, so an already-published URL is never touched.
    const removed = images[index];
    if (removed) void deleteStagedIfUnconsumed(removed.url).catch(() => {});
    setImages((current) => current.filter((_, i) => i !== index));
  }

  function updateAlt(index: number, alt: string) {
    setImages((current) => current.map((img, i) => (i === index ? { ...img, alt } : img)));
  }

  const errorEntries = Object.entries(fieldErrors);

  // The four things a strong listing has, shown at the top and — on a phone,
  // where the top scrolls away — in the pinned commit bar.
  const readiness = [
    { label: "Photos", done: images.length > 0 },
    { label: "Condition", done: !usedNeedsGrade || Boolean(grade) },
    { label: "Fitment", done: fitmentCount > 0 },
    // "0.00" is the blank default, not a decision — only a real price (or a
    // non-flat mode) counts, matching the "$0 shipping" check below.
    { label: "Shipping", done: shippingMode !== "flat" || Number(shipping) > 0 },
  ];
  const readyCount = readiness.filter((r) => r.done).length;

  const publishBlocked = !isEdit && !canPublish;
  const commitLabel = pending
    ? isEdit
      ? "Saving…"
      : "Publishing…"
    : isEdit
      ? "Save changes"
      : "Publish";
  /** The primary submit — the in-flow row and the phone's pinned bar share it. */
  const commitButton = (
    // Gated publish stays focusable (a `disabled` button vanishes from the
    // tab order, so its checklist reference would never be announced) —
    // aria-disabled + a guarded click instead.
    <Button
      type="submit"
      variant="live"
      disabled={pending || uploading}
      aria-disabled={publishBlocked ? true : undefined}
      aria-describedby={publishBlocked ? "publish-checklist" : undefined}
      onClick={(e) => {
        if (publishBlocked) e.preventDefault();
      }}
      className={publishBlocked ? "opacity-55 cursor-not-allowed" : undefined}
    >
      {commitLabel}
    </Button>
  );

  return (
    <form
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (submitting.current) return;
        const formData = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
        const errors = validate(formData);
        if (Object.keys(errors).length) {
          setFieldErrors(errors);
          // Submitting from the pinned bar leaves the summary off-screen —
          // take the reader to the first field that needs them.
          const first = Object.keys(fieldAnchors).find((key) => errors[key]);
          if (first) {
            requestAnimationFrame(() => {
              const target = document.getElementById(fieldAnchors[first]);
              target?.scrollIntoView({ block: "center" });
              target?.focus({ preventScroll: true });
            });
          }
          return;
        }
        setFieldErrors({});
        if (!isEdit) {
          creationRequestId.current ??= crypto.randomUUID();
          formData.set("request_id", creationRequestId.current);
        }
        submitting.current = true;
        setPending(true);
        setState({});
        try {
          setState(await (isEdit ? updateListing : createListing)({}, formData));
        } catch (error) {
          unstable_rethrow(error);
          setState({ error: "Couldn’t confirm the save. Your draft is still here; try again." });
        } finally {
          submitting.current = false;
          setPending(false);
        }
      }}
      className="deck !pb-0"
    >
      <input type="hidden" name="image_urls" value={JSON.stringify(images)} />
      {listing && <input type="hidden" name="id" value={listing.id} />}
      {prefill?.modItemId && (
        <input type="hidden" name="mod_item_id" value={prefill.modItemId} />
      )}
      {importReview && <input type="hidden" name="import_id" value={importReview.id} />}

      {importReview && (
        <div role="status" className="tile !mb-0">
          <p className="microlabel microlabel--ink">
            Imported from {importReview.sourceLabel} — check the details before publishing.
          </p>
          {importReview.issues.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-micro text-dim">
              {importReview.issues.map((issue) => (
                <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          )}
          {importReview.originalText && (
            <details className="mt-2">
              <summary className="jumplink cursor-pointer text-micro">
                Original post — nothing was lost
              </summary>
              <p className="mt-1 whitespace-pre-wrap text-micro text-dim">
                {importReview.originalText}
              </p>
            </details>
          )}
        </div>
      )}

      <ValidationSummary
        entries={errorEntries.map(([field, message]) => ({
          anchor: fieldAnchors[field] ?? field,
          label: fieldLabels[field] ?? field,
          message,
        }))}
      />

      {/* Completeness checklist — a lightweight, live-updating nudge toward a
          strong listing. The hard requirements are enforced in validate()
          and on the server. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-micro uppercase tracking-[0.08em] text-dim">
        {readiness.map((r, index) => (
          <span key={r.label} className="contents">
            {index > 0 && <span aria-hidden="true">·</span>}
            <span>
              {r.label} {r.done ? "✓" : "—"}
            </span>
          </span>
        ))}
      </div>

      {/* Photos lead (M-5/W-2): the photo is what a buyer sees first on every
          card, and a public listing needs one. */}
      <FormSection
        step={1}
        title="Photos"
        hint={
          issueFor("photos") ??
          "Up to 12. The first is the cover — drag to reorder (or use the arrows), ★ makes a photo the cover."
        }
      >
        <div id="sell-photos" tabIndex={-1} className="flex flex-col gap-3 outline-none">
          {(images.length > 0 || pendingUploads.length > 0) && (
            <SortableGrid
              ids={images.map((img) => img.url)}
              onReorder={(urls) => {
                const byUrl = new Map(images.map((img) => [img.url, img]));
                setImages(urls.flatMap((url) => (byUrl.has(url) ? [byUrl.get(url)!] : [])));
              }}
              className="thumbs thumbs--edit thumbs--cover !mt-0 m-0 list-none p-0"
            >
              {images.map((img, index) => (
                <SortableItem
                  key={img.url}
                  id={img.url}
                  label={`Photo ${index + 1}`}
                  className="thumb group"
                >
                  <Media
                    src={img.url}
                    alt={img.alt || `Photo ${index + 1}`}
                    className="h-full w-full"
                    role="thumb"
                  />
                  {index === 0 && (
                    <span className="thumb__tag" aria-hidden="true">
                      Cover
                    </span>
                  )}
                  {/* The garage gallery's control bars: reorder + cover on
                      top, describe + remove below. Visible on hover/focus,
                      always on touch. */}
                  <div className="thumb__ctl absolute inset-x-0 top-1 z-10 flex items-start justify-between px-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
                    <div className="thumb__ctl flex">
                      <button
                        type="button"
                        onClick={() => moveImage(index, -1)}
                        disabled={index === 0}
                        aria-label={`Move photo ${index + 1} earlier`}
                        className="thumb__x !relative !top-0 !right-0 disabled:opacity-30"
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        onClick={() => moveImage(index, 1)}
                        disabled={index === images.length - 1}
                        aria-label={`Move photo ${index + 1} later`}
                        className="thumb__x !relative !top-0 !right-0 disabled:opacity-30"
                      >
                        →
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => makeCover(index)}
                      disabled={index === 0}
                      aria-label={index === 0 ? `Photo ${index + 1} is the cover` : `Set photo ${index + 1} as cover`}
                      className="thumb__x !relative !top-0 !right-0 disabled:opacity-30"
                    >
                      ★
                    </button>
                  </div>
                  <div className="thumb__ctl thumb__ctl--second absolute right-1 z-10 flex opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
                    <button
                      type="button"
                      onClick={() => setEditingAlt(editingAlt === img.url ? null : img.url)}
                      aria-label={`Describe photo ${index + 1}`}
                      aria-expanded={editingAlt === img.url}
                      className="thumb__x !relative !top-0 !right-0"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (editingAlt === img.url) setEditingAlt(null);
                        removeImage(index);
                      }}
                      aria-label={`Remove photo ${index + 1}`}
                      className="thumb__x !relative !top-0 !right-0"
                    >
                      ✕
                    </button>
                  </div>
                </SortableItem>
              ))}
              {pendingUploads.map((item) => (
                <div key={item.id} className="thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.previewUrl} alt="" className="h-full w-full object-cover opacity-75" />
                  <span className="thumb__tag">
                    {item.status === "failed" ? "Failed" : "Uploading…"}
                  </span>
                </div>
              ))}
            </SortableGrid>
          )}

          {/* Failed uploads say why, with their own retry — beside the grid
              rather than squeezed under a 100px tile. */}
          {pendingUploads
            .filter((item) => item.status === "failed")
            .map((item) => (
              <p key={item.id} className="field__err flex-wrap">
                <span>{item.error}</span>
                {item.retryable && (
                  <button type="button" className="jumplink" onClick={() => queue.retry(item.id)}>
                    Retry
                  </button>
                )}
                <button type="button" className="jumplink" onClick={() => queue.remove(item.id)}>
                  Remove
                </button>
              </p>
            ))}

          {editingAlt !== null &&
            (() => {
              const index = images.findIndex((img) => img.url === editingAlt);
              if (index < 0) return null;
              return (
                <TextField
                  id="sell-photo-alt"
                  label={`Describe photo ${index + 1}`}
                  optional
                  value={images[index].alt ?? ""}
                  onChange={(e) => updateAlt(index, e.target.value)}
                  maxLength={200}
                  placeholder="e.g. Both calipers, dust boots intact"
                  hint="Read aloud to buyers using a screen reader."
                  className="max-w-none"
                />
              );
            })()}

          {images.length + pendingUploads.length < 12 && (
            <DropZone
              onFiles={handleFiles}
              busy={uploading}
              title={images.length ? "Add more photos" : "Add photos"}
              body={
                images.length
                  ? "Drop them here or choose files. Drag the tiles above to reorder."
                  : "Drop them here or choose files. Show the actual part, from a few angles."
              }
            />
          )}
          {(fieldErrors.photos || uploadError) && (
            <p role="alert" aria-live="polite" className="field__err">
              {fieldErrors.photos ?? uploadError}
            </p>
          )}
        </div>
      </FormSection>

      <FormSection step={2} title="The part — what you're releasing">
        <TextField
          id="sell-title"
          name="title"
          label="Title"
          maxLength={140}
          defaultValue={listing?.title ?? prefill?.title ?? ""}
          placeholder="e.g. 034 High-Flow Downpipe for B9 S4"
          className="max-w-none"
          error={fieldErrors.title}
          hint={issueFor("title") ?? "Clear titles sell faster — brand, model, then the car it fits."}
        />
        {/* .field--row collapses to one column on small screens; a bare
            grid-cols-2 kept these side by side at 375px. */}
        <div className="field--row">
          <Select
            id="sell-category"
            name="category"
            label="Category"
            value={category}
            onChange={(e) => { setCategory(e.target.value); setSubcategory(""); }}
            className="max-w-none"
            error={fieldErrors.category}
            hint={
              issueFor("category") ??
              (!listing &&
              prefill?.modConfidence !== undefined &&
              prefill?.modConfidence !== null &&
              isLowConfidence(prefill.modConfidence)
                ? "Guessed from a low-confidence parse of the build line — check it."
                : undefined)
            }
          >
            <option value="" disabled>
              Choose…
            </option>
            {CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </Select>
          <Select
            id="sell-subcategory"
            name="subcategory"
            label="Part type"
            optional
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
            className="max-w-none"
            disabled={!subcategories.length}
          >
            <option value="">Not sure — keep in the main category</option>
            {subcategories.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="field--row">
          <Select
            id="sell-condition"
            name="condition"
            label="Condition"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            className="max-w-none"
            hint={issueFor("condition")}
          >
            {CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          <TextField
            id="sell-brand"
            name="brand"
            label="Brand"
            optional
            maxLength={120}
            defaultValue={listing?.brand ?? prefill?.brand ?? ""}
            placeholder="e.g. Öhlins"
            className="max-w-none"
            hint="Who made it. Buyers filter by this more than anything else."
          />
        </div>
        <TextField
          id="sell-part_number"
          name="part_number"
          label="Part number"
          optional
          maxLength={120}
          defaultValue={listing?.part_number ?? prefill?.partNumber ?? ""}
          placeholder="e.g. CP9660-2S4"
          className="max-w-none"
          hint={issueFor("part_number") ?? "What a buyer cross-references. Seller-entered, not verified."}
        />
        {/* M-7. Used parts only: on a new part it would be a contradiction
            rather than a detail, and a zero would read as a claim. */}
        {condition !== "new" && (
          <div className="field--row">
            <TextField
              id="sell-part_miles"
              name="part_miles"
              label="Miles on this part"
              optional
              type="number"
              min={0}
              max={2000000}
              inputMode="numeric"
              defaultValue={listing?.part_miles ?? ""}
              placeholder="e.g. 18000"
              className="max-w-none"
              hint="How far it has been driven. A condition grade can't answer that."
            />
            {/* Two options, one visible choice — a segmented pair on the
                input's baseline rather than a select that rendered taller
                than the field beside it. */}
            <fieldset className="field">
              <legend className="microlabel">Unit</legend>
              <span className="flex gap-5">
                <Radio
                  name="part_miles_unit"
                  value="mi"
                  label="Miles"
                  defaultChecked={(listing?.part_miles_unit ?? "mi") === "mi"}
                />
                <Radio
                  name="part_miles_unit"
                  value="km"
                  label="Kilometres"
                  defaultChecked={listing?.part_miles_unit === "km"}
                />
              </span>
            </fieldset>
          </div>
        )}
        <TextField
          id="sell-alt_part_numbers"
          name="alt_part_numbers"
          label="Other numbers it's known by"
          optional
          maxLength={240}
          defaultValue={listing?.alt_part_numbers?.join(", ") ?? ""}
          placeholder="OEM, superseded or equivalent numbers — comma-separated"
          className="max-w-none"
          hint="Buyers searching any of these find the listing."
        />
        {/* Grade + checklist: dispute prevention (0024). Only for used parts —
            "new" already says everything a grade would. The checklist follows
            the category, so a turbo gets asked about shaft play and a wheel
            about curb rash; every answer renders on the listing and freezes
            onto the order as the contract. */}
        {condition !== "new" && (
          <>
            <Select
              id="sell-grade"
              name="grade"
              label="Grade — how honest sellers price"
              value={grade}
              onChange={(e) => {
                setGrade(e.target.value);
                setAttestAccurate(false);
              }}
              className="max-w-none"
            >
              <option value="">Not graded</option>
              {GRADES.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label} — {g.meaning}
                </option>
              ))}
            </Select>
            {category && (
              <fieldset className="field">
                <legend className="microlabel">
                  Condition checklist — each answer shows on the listing
                </legend>
                <div
                  className="flex flex-col"
                  onChange={() => setAttestAccurate(false)}
                >
                  {checklistFor(category, subcategory || null).map((q) => (
                    // Question, then its three answers directly beneath — at
                    // desktop width a right-aligned group sat ~600px from the
                    // question it answered.
                    <div
                      key={q.key}
                      className="flex flex-col border-b border-[color:var(--rule-soft)] pb-1 pt-3 last:border-b-0"
                    >
                      <span className="text-body">{q.label}</span>
                      <span className="flex flex-wrap gap-x-6" role="radiogroup" aria-label={q.label}>
                        {(["yes", "no", "unknown"] as const).map((answer) => (
                          <Radio
                            key={answer}
                            name={`chk_${q.key}`}
                            value={answer}
                            label={answer === "unknown" ? "Not sure" : answer === "yes" ? "Yes" : "No"}
                            defaultChecked={listing?.condition_checklist?.[q.key] === answer}
                          />
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
                <span className="field__hint">
                  Answer what you know — honest &quot;not sure&quot; beats a wrong yes. These are
                  part of the sale record if there&apos;s ever a dispute.
                </span>
              </fieldset>
            )}
            {grade && (
              <div className={fieldErrors.attest_accurate ? "field is-invalid" : "field"}>
                <Checkbox
                  id="sell-attest"
                  name="attest_accurate"
                  checked={attestAccurate}
                  onChange={(e) => setAttestAccurate(e.target.checked)}
                  aria-describedby={fieldErrors.attest_accurate ? "sell-attest-error" : undefined}
                  label="I confirm this condition disclosure is accurate."
                />
                {fieldErrors.attest_accurate && (
                  <p id="sell-attest-error" className="field__err">
                    {fieldErrors.attest_accurate}
                  </p>
                )}
              </div>
            )}
          </>
        )}
        <TextArea
          id="sell-description"
          name="description"
          label="Description"
          rows={4}
          maxLength={8000}
          defaultValue={listing?.description ?? prefill?.description ?? ""}
          placeholder="What is it, why is it coming off, anything a buyer should know."
          className="!max-w-none"
        />
      </FormSection>

      <FormSection
        step={3}
        title="Where it came from"
        hint="Optional — linking a car in your garage attaches the sheet's context to the listing."
      >
        <Select
          id="sell-source_car"
          name="source_car_id"
          label="Source car"
          value={sourceCarId}
          onChange={(event) => setSourceCarId(event.target.value)}
          className="max-w-none"
          hint={
            prefill?.modItemId
              ? "Released off a build line — the listing will show on that line of the car sheet."
              : undefined
          }
        >
          <option value="">Bought spare / never fitted — no car sheet behind it</option>
          {cars.map((car) => (
            <option key={car.id} value={car.id}>
              Off my sheet — {car.name}
            </option>
          ))}
        </Select>
      </FormSection>

      <FormSection
        step={4}
        title="Fitment — what it fits"
        hint="Seller-stated, shown as informational. Never a guarantee."
      >
        <FitmentPicker
          makes={makes}
          initial={listing?.fitments ?? prefill?.fitment ?? []}
          suggestion={(() => {
            // Passive inference from the chosen source car (brief §G): a
            // one-tap chip, never an unexplained transformation.
            const car = cars.find((c) => c.id === sourceCarId);
            return car?.make && car?.model
              ? {
                  make: car.make,
                  model: car.model,
                  year: car.year ?? null,
                  label: [car.year, car.make, car.model].filter(Boolean).join(" "),
                }
              : null;
          })()}
          onCountChange={setFitmentCount}
        />
        {issueFor("fitment") && <p className="spec-note">{issueFor("fitment")}</p>}
        <TextArea
          id="sell-compatibility_notes"
          name="compatibility_notes"
          label="Notes — anything the rows can't say"
          optional
          rows={3}
          maxLength={2000}
          defaultValue={listing?.compatibility_notes ?? prefill?.compatibilityNotes ?? ""}
          placeholder='e.g. "Needs the OEM bracket from a facelift car. Verify for RS5."'
          className="!max-w-none"
        />
      </FormSection>

      <FormSection step={5} title="Price, shipping & location">
        <div className="field--row">
          <TextField
            id="sell-price"
            name="price"
            label="Asking price"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0"
            prefix="$"
            error={fieldErrors.price}
            hint={issueFor("price")}
          />
          <TextField
            id="sell-offer_floor"
            name="offer_floor"
            label="Lowest offer you'd read"
            optional
            inputMode="decimal"
            defaultValue={money(listing?.offer_floor_cents) || suggestedFloor}
            placeholder=""
            prefix="$"
            hint={
              issueFor("offers") ??
              (defaultOfferFloorPct && !listing
                ? `Offers below this are declined automatically, and buyers see "offers from" this amount. Prefilled at your ${defaultOfferFloorPct}% default.`
                : 'Offers below this are declined automatically, and buyers see "offers from" this amount.')
            }
          />
        </div>
        {/* Full width, short options: the select used to share a row and
            truncate its own first option. The detail lives in the hint. */}
        <Select
          id="sell-shipping-mode"
          name="shipping_mode"
          label="How it ships"
          value={shippingMode}
          onChange={(e) =>
            setShippingMode(e.target.value as "flat" | "drvn" | "pickup_only")
          }
          className="max-w-none"
          hint={
            shippingMode === "drvn"
              ? drvnShipping && !drvnShipping.profileReady
                ? "Needs your verified ship-from address — Settings → Shipping."
                : "Buyers see live carrier rates at checkout; the label comes back to you on the order."
              : shippingMode === "pickup_only"
                ? "No shipping — buyers collect in person."
                : "You set the price and send it yourself."
          }
        >
          <option value="flat">Flat rate</option>
          {drvnShipping?.enabled && <option value="drvn">DRVN Shipping</option>}
          <option value="pickup_only">Local pickup only</option>
        </Select>
        {shippingMode === "flat" && (
          <TextField
            id="sell-shipping"
            name="shipping"
            label="Shipping — flat rate"
            inputMode="decimal"
            value={shipping}
            onChange={(e) => setShipping(e.target.value)}
            placeholder="0"
            prefix="$"
            hint={issueFor("shipping") ?? "Leave at 0 for free shipping."}
          />
        )}
        {shippingMode === "drvn" && (
          <div className="grid gap-3 sm:grid-cols-4">
            <TextField
              id="sell-weight"
              name="weight_oz"
              label="Packed weight (oz)"
              inputMode="decimal"
              defaultValue={listing?.weight_oz != null ? String(listing.weight_oz) : ""}
              placeholder="0"
              error={fieldErrors.weight_oz}
              fieldClassName="!mb-0"
            />
            <TextField
              id="sell-length"
              name="length_in"
              label="Length (in)"
              inputMode="decimal"
              defaultValue={listing?.length_in != null ? String(listing.length_in) : ""}
              placeholder="0"
              error={fieldErrors.length_in}
              fieldClassName="!mb-0"
            />
            <TextField
              id="sell-width"
              name="width_in"
              label="Width (in)"
              inputMode="decimal"
              defaultValue={listing?.width_in != null ? String(listing.width_in) : ""}
              placeholder="0"
              error={fieldErrors.width_in}
              fieldClassName="!mb-0"
            />
            <TextField
              id="sell-height"
              name="height_in"
              label="Height (in)"
              inputMode="decimal"
              defaultValue={listing?.height_in != null ? String(listing.height_in) : ""}
              placeholder="0"
              error={fieldErrors.height_in}
              fieldClassName="!mb-0"
            />
            <p className="field__hint sm:col-span-4 !mt-0">
              Measure the part boxed, as it will ship. Buyers see carrier rates
              calculated from this at checkout.
            </p>
          </div>
        )}
        <TextField
          id="sell-location"
          name="location"
          label="Location"
          optional
          defaultValue={listing?.location ?? prefill?.location ?? ""}
          placeholder="City, state"
          className="max-w-none"
        />
        {shippingMode === "pickup_only" ? (
          // Pickup-only implies collection; the server sets it regardless.
          <Checkbox checked readOnly disabled label="Buyers collect in person (pickup-only listing)" />
        ) : (
          <Checkbox
            name="allows_collection"
            defaultChecked={listing?.allows_collection ?? prefill?.allowsCollection ?? false}
            label="Buyers may collect in person"
          />
        )}
      </FormSection>

      {!isEdit &&
        (() => {
          const warnings: string[] = [];
          if (usedNeedsGrade && !grade) warnings.push("No grade set for a used part — buyers weight this heavily.");
          if (shippingMode === "flat" && (!shipping.trim() || Number(shipping) === 0)) warnings.push("Shipping is $0 — confirm that's intentional, not just unset.");
          const needsPhoto = images.length === 0;
          const show = warnings.length > 0 || !canPublish || needsPhoto;
          // The checklist folds in and out as answers change — while typing,
          // an instant blink here read as the form glitching.
          return (
            <AnimatePresence initial={false}>
              {show && (
                <motion.div
                  key="publish-checklist"
                  variants={expand}
                  initial="collapsed"
                  animate="expanded"
                  exit="collapsed"
                  className="overflow-hidden"
                >
            <div role="status" aria-live="polite" id="publish-checklist" className="tile !mb-0">
              <p className="microlabel microlabel--ink">Before you publish</p>
              <ul className="mt-1 list-disc pl-5 text-micro text-dim">
                {/* Blockers lead: money needs somewhere to go, and a public
                    listing needs its picture. */}
                {!canPublish && (
                  <li>
                    <b className="text-ink">Payouts aren&apos;t set up — required to publish.</b>{" "}
                    <Link href="/payouts" className="jumplink">
                      Set up payouts →
                    </Link>
                  </li>
                )}
                {needsPhoto && (
                  <li>
                    <b className="text-ink">No photos yet — add at least one to publish.</b>{" "}
                    <a href="#sell-photos" className="jumplink">
                      Add photos →
                    </a>
                  </li>
                )}
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <p className="field__hint mt-1">
                {!canPublish || needsPhoto
                  ? "Drafts save any time — publishing unlocks once the bold items are done."
                  : "These are nudges, not blockers — you can still publish or save a draft as-is."}
              </p>
            </div>
                </motion.div>
              )}
            </AnimatePresence>
          );
        })()}

      <ActionFooter
        aux={
          <span className="spec-note !mt-0 !border-t-0 !pt-0">
            {isEdit ? (
              <>Changes go live on the market immediately.</>
            ) : (
              <b>Save a draft and nothing reaches the market until you publish.</b>
            )}
          </span>
        }
        status={
          state.error
            ? { kind: "error", message: state.error }
            : state.ok
              ? { kind: "ok", message: state.ok }
              : null
        }
        className="!mt-0"
      >
        <span className="flex flex-wrap justify-end gap-2">
          {!isEdit && (
            <Button
              type="submit"
              variant="ghost"
              name="save_draft"
              value="1"
              disabled={pending || uploading}
            >
              Save draft
            </Button>
          )}
          {commitButton}
        </span>
      </ActionFooter>

      {/* Compact widths: the commit is ~5 screens down, so it rides in a
          pinned bar with the asking price and how complete the listing is.
          (Save draft stays with the in-flow row.) */}
      <MobileActionBar
        label={isEdit ? "Save listing" : "Publish listing"}
        totalLabel="Asking"
        total={
          price.trim() && Number.isFinite(Number(price))
            ? `$${Number(price).toLocaleString("en-US", { maximumFractionDigits: 2 })}`
            : "Not set"
        }
        ship={`${readyCount} of ${readiness.length} ready`}
      >
        {commitButton}
      </MobileActionBar>
    </form>
  );
}
