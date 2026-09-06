"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";

import { AnimatePresence, motion } from "motion/react";

import { Button, FormSection, Media, Select, TextArea, TextField, ValidationSummary } from "@/components/ui";
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
  const fileRef = useRef<HTMLInputElement>(null);
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
  const [attestAccurate, setAttestAccurate] = useState(false);
  const [price, setPrice] = useState(listing ? money(listing.price_cents) : prefill?.price ?? "");
  const [shipping, setShipping] = useState(
    listing ? money(listing.shipping_cents ?? 0) : prefill?.shipping ?? money(0)
  );
  const [fitmentCount, setFitmentCount] = useState(
    listing?.fitments?.length ?? prefill?.fitment?.length ?? 0
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const usedNeedsGrade = condition !== "new";

  /** Mirrors the server's hard checks that a submitter can see before the
   *  round-trip — anything the server alone can validate (ownership, rate
   *  limits) stays server-side and still surfaces via state.error. */
  function validate(formData: FormData): Record<string, string> {
    const errors: Record<string, string> = {};
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

    return errors;
  }

  const fieldLabels: Record<string, string> = {
    title: "Title",
    category: "Category",
    price: "Asking price",
    attest_accurate: "Condition disclosure confirmation",
  };
  const fieldAnchors: Record<string, string> = {
    title: "sell-title",
    category: "sell-category",
    price: "sell-price",
    attest_accurate: "sell-attest",
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
    if (fileRef.current) fileRef.current.value = "";
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

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (submitting.current) return;
        const formData = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
        const errors = validate(formData);
        if (Object.keys(errors).length) {
          setFieldErrors(errors);
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
          strong listing. Nothing here blocks submit; the hard requirements
          are enforced above and on the server. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-micro uppercase tracking-[0.08em] text-dim">
        <span>Photos {images.length > 0 ? "✓" : "—"}</span>
        <span aria-hidden="true">·</span>
        <span>Condition {!usedNeedsGrade || grade ? "✓" : "—"}</span>
        <span aria-hidden="true">·</span>
        <span>Fitment {fitmentCount > 0 ? "✓" : "—"}</span>
        <span aria-hidden="true">·</span>
        <span>Shipping {shippingMode !== "flat" || shipping.trim() !== "" ? "✓" : "—"}</span>
      </div>

      <FormSection step={1} title="The part — what you're releasing">
        <TextField
          id="sell-title"
          name="title"
          label="Title"
          required
          maxLength={140}
          defaultValue={listing?.title ?? prefill?.title ?? ""}
          placeholder="e.g. 034 High-Flow Downpipe for B9 S4"
          className="max-w-none"
          fieldClassName="!mb-0"
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
            required
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="max-w-none"
            fieldClassName="!mb-0"
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
            label="Subcategory"
            optional
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
            className="max-w-none"
            fieldClassName="!mb-0"
            disabled={!subcategories.length}
          >
            <option value="">—</option>
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
            fieldClassName="!mb-0"
            hint={issueFor("condition")}
          >
            {CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          <TextField
            id="sell-part_number"
            name="part_number"
            label="Part number"
            optional
            maxLength={120}
            defaultValue={listing?.part_number ?? prefill?.partNumber ?? ""}
            placeholder="e.g. CP9660-2S4"
            className="max-w-none"
            fieldClassName="!mb-0"
            hint={issueFor("part_number") ?? "What a buyer cross-references. Seller-entered, not verified."}
          />
        </div>
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
              onChange={(e) => setGrade(e.target.value)}
              className="max-w-none"
              fieldClassName="!mb-0"
            >
              <option value="">Not graded</option>
              {GRADES.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label} — {g.meaning}
                </option>
              ))}
            </Select>
            {category && (
              <fieldset className="field !mb-0">
                <legend className="microlabel">
                  Condition checklist — each answer shows on the listing
                </legend>
                <div className="mt-1 flex flex-col gap-2">
                  {checklistFor(category, subcategory || null).map((q) => (
                    <div key={q.key} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-micro">{q.label}</span>
                      <span className="flex gap-3" role="radiogroup" aria-label={q.label}>
                        {(["yes", "no", "unknown"] as const).map((answer) => (
                          <label key={answer} className="flex items-center gap-1 font-mono text-micro uppercase tracking-[0.08em] text-dim">
                            <input
                              type="radio"
                              name={`chk_${q.key}`}
                              value={answer}
                              defaultChecked={listing?.condition_checklist?.[q.key] === answer}
                              className="accent-live"
                            />
                            {answer === "unknown" ? "Not sure" : answer}
                          </label>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
                <span className="field__hint mt-1">
                  Answer what you know — honest &quot;not sure&quot; beats a wrong yes. These are
                  part of the sale record if there&apos;s ever a dispute.
                </span>
              </fieldset>
            )}
            {grade && (
              <label className="flex items-start gap-2 text-micro">
                <input
                  type="checkbox"
                  id="sell-attest"
                  name="attest_accurate"
                  checked={attestAccurate}
                  onChange={(e) => setAttestAccurate(e.target.checked)}
                  className="accent-live mt-0.5"
                  aria-describedby={fieldErrors.attest_accurate ? "sell-attest-error" : undefined}
                />
                <span>I confirm this condition disclosure is accurate.</span>
              </label>
            )}
            {grade && fieldErrors.attest_accurate && (
              <p id="sell-attest-error" className="field__err">
                {fieldErrors.attest_accurate}
              </p>
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
          fieldClassName="!mb-0"
        />
      </FormSection>

      <FormSection
        step={2}
        title="Photos"
        hint={
          issueFor("photos") ??
          "Up to 12 — the first frame is the cover. Reorder, set a cover, or add alt text below."
        }
      >
        <SortableGrid
          ids={images.map((img) => img.url)}
          onReorder={(urls) => {
            const byUrl = new Map(images.map((img) => [img.url, img]));
            setImages(urls.flatMap((url) => (byUrl.has(url) ? [byUrl.get(url)!] : [])));
          }}
          className="thumbs !mt-0"
        >
          {images.map((img, index) => (
            <SortableItem
              key={img.url}
              id={img.url}
              label={`Photo ${index + 1}`}
              className="flex flex-col gap-1.5"
            >
              <span className="thumb">
                <Media
                  src={img.url}
                  alt={img.alt || `Photo ${index + 1}`}
                  className="h-full w-full"
                  role="thumb"
                />
                {index === 0 && <span className="thumb__tag">Cover</span>}
                <button
                  type="button"
                  onClick={() => removeImage(index)}
                  className="thumb__x pointer-coarse:!h-10 pointer-coarse:!w-10"
                  aria-label={`Remove photo ${index + 1}`}
                >
                  ✕
                </button>
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveImage(index, -1)}
                  disabled={index === 0}
                  className="rounded-[6px] border border-[var(--dimline)] px-1.5 py-0.5 font-mono text-micro uppercase tracking-[0.08em] text-dim transition hover:text-ink disabled:opacity-30 pointer-coarse:min-h-10 pointer-coarse:min-w-10"
                  aria-label={`Move photo ${index + 1} earlier`}
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => moveImage(index, 1)}
                  disabled={index === images.length - 1}
                  className="rounded-[6px] border border-[var(--dimline)] px-1.5 py-0.5 font-mono text-micro uppercase tracking-[0.08em] text-dim transition hover:text-ink disabled:opacity-30 pointer-coarse:min-h-10 pointer-coarse:min-w-10"
                  aria-label={`Move photo ${index + 1} later`}
                >
                  →
                </button>
                {index !== 0 && (
                  <button
                    type="button"
                    onClick={() => makeCover(index)}
                    className="flex-1 truncate rounded-[6px] border border-[var(--dimline)] px-1.5 py-0.5 font-mono text-micro uppercase tracking-[0.08em] text-dim transition hover:text-ink pointer-coarse:min-h-10"
                  >
                    Set cover
                  </button>
                )}
              </div>
              <input
                value={img.alt ?? ""}
                onChange={(e) => updateAlt(index, e.target.value)}
                placeholder="Alt text — optional"
                maxLength={200}
                className="ctl max-w-none !py-1 text-micro pointer-coarse:min-h-10"
                aria-label={`Alt text for photo ${index + 1}`}
              />
            </SortableItem>
          ))}
          {pendingUploads.map((item) => (
            <div key={item.id} className="flex flex-col gap-1.5">
              <span className="thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.previewUrl}
                  alt=""
                  className="h-full w-full object-cover opacity-75"
                />
              </span>
              {item.status === "failed" ? (
                <span className="flex flex-wrap items-center gap-2 text-micro text-live">
                  <span className="truncate">{item.error}</span>
                  {item.retryable && (
                    <button type="button" className="jumplink" onClick={() => queue.retry(item.id)}>
                      Retry
                    </button>
                  )}
                  <button type="button" className="jumplink" onClick={() => queue.remove(item.id)}>
                    Remove
                  </button>
                </span>
              ) : (
                <span className="font-mono text-micro uppercase tracking-[0.08em] text-dim">
                  Uploading…
                </span>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="thumb thumb--ghost grid place-items-center self-start font-mono text-xs uppercase tracking-[0.1em] text-dim"
          >
            {uploading ? "Uploading…" : "+ Add"}
          </button>
        </SortableGrid>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
        {uploadError && (
          <p role="alert" aria-live="polite" className="field__err">
            {uploadError}
          </p>
        )}
      </FormSection>

      <FormSection
        step={3}
        title="Where it came from"
        hint="Optional — linking a car in your garage attaches the sheet's context to the listing."
      >
        <select
          name="source_car_id"
          value={sourceCarId}
          onChange={(event) => setSourceCarId(event.target.value)}
          className="ctl max-w-none"
        >
          <option value="">Bought spare / never fitted — no car sheet behind it</option>
          {cars.map((car) => (
            <option key={car.id} value={car.id}>
              Off my sheet — {car.name}
            </option>
          ))}
        </select>
        {prefill?.modItemId && (
          <p className="spec-note">
            Released off a build line — the listing will show on that line of the car sheet.
          </p>
        )}
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
        <div className="field !mb-0">
          <label htmlFor="sell-compatibility_notes" className="microlabel">
            Notes — anything the rows can&apos;t say
          </label>
          <textarea
            id="sell-compatibility_notes"
            name="compatibility_notes"
            rows={3}
            maxLength={2000}
            defaultValue={listing?.compatibility_notes ?? prefill?.compatibilityNotes ?? ""}
            placeholder='e.g. "Needs the OEM bracket from a facelift car. Verify for RS5."'
            className="ctl !max-w-none"
          />
        </div>
      </FormSection>

      <FormSection step={5} title="Price, shipping & location">
        <div className="field--row">
          <TextField
            id="sell-price"
            name="price"
            label="Asking price"
            required
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0"
            prefix="$"
            fieldClassName="!mb-0"
            error={fieldErrors.price}
            hint={issueFor("price")}
          />
          <Select
            id="sell-shipping-mode"
            name="shipping_mode"
            label="How it ships"
            value={shippingMode}
            onChange={(e) =>
              setShippingMode(e.target.value as "flat" | "drvn" | "pickup_only")
            }
            fieldClassName="!mb-0"
            hint={
              shippingMode === "drvn" && drvnShipping && !drvnShipping.profileReady
                ? "Needs your verified ship-from address — Settings → Shipping."
                : undefined
            }
          >
            <option value="flat">Flat rate — I arrange shipping</option>
            {drvnShipping?.enabled && (
              <option value="drvn">DRVN Shipping — buyer sees live rates</option>
            )}
            <option value="pickup_only">Local pickup only</option>
          </Select>
        </div>
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
            fieldClassName="!mb-0"
            hint={issueFor("shipping") ?? "Leave at 0 for free shipping."}
          />
        )}
        {shippingMode === "drvn" && (
          <div className="grid gap-3 sm:grid-cols-4">
            <TextField
              id="sell-weight"
              name="weight_oz"
              label="Packed weight (oz)"
              required
              inputMode="decimal"
              defaultValue={listing?.weight_oz != null ? String(listing.weight_oz) : ""}
              placeholder="0"
              fieldClassName="!mb-0"
            />
            <TextField
              id="sell-length"
              name="length_in"
              label="Length (in)"
              required
              inputMode="decimal"
              defaultValue={listing?.length_in != null ? String(listing.length_in) : ""}
              placeholder="0"
              fieldClassName="!mb-0"
            />
            <TextField
              id="sell-width"
              name="width_in"
              label="Width (in)"
              required
              inputMode="decimal"
              defaultValue={listing?.width_in != null ? String(listing.width_in) : ""}
              placeholder="0"
              fieldClassName="!mb-0"
            />
            <TextField
              id="sell-height"
              name="height_in"
              label="Height (in)"
              required
              inputMode="decimal"
              defaultValue={listing?.height_in != null ? String(listing.height_in) : ""}
              placeholder="0"
              fieldClassName="!mb-0"
            />
            <p className="field__hint sm:col-span-4 !mt-0">
              Measure the part boxed, as it will ship. Buyers see carrier rates
              calculated from this at checkout; the label comes back to you on
              the order sheet.
            </p>
          </div>
        )}
        <div className="field--row">
          <TextField
            id="sell-offer_floor"
            name="offer_floor"
            label="Lowest offer you'd read"
            optional
            inputMode="decimal"
            defaultValue={money(listing?.offer_floor_cents)}
            placeholder="—"
            prefix="$"
            fieldClassName="!mb-0"
            hint={issueFor("offers") ?? "Offers below this are declined automatically."}
          />
          <div className="field !mb-0">
            <label htmlFor="sell-location" className="microlabel">Location</label>
            <input id="sell-location"
              name="location"
              defaultValue={listing?.location ?? prefill?.location ?? ""}
              placeholder="City, state"
              className="ctl max-w-none"
            />
          </div>
        </div>
        {shippingMode === "pickup_only" ? (
          <label className="flex items-center gap-2 text-micro">
            <input type="checkbox" checked readOnly disabled className="accent-live" />
            {/* Pickup-only implies collection; the server sets it regardless. */}
            Buyers collect in person (pickup-only listing)
          </label>
        ) : (
          <label className="flex items-center gap-2 text-micro">
            <input
              type="checkbox"
              name="allows_collection"
              defaultChecked={listing?.allows_collection ?? prefill?.allowsCollection ?? false}
              className="accent-live"
            />
            Buyers may collect in person
          </label>
        )}
      </FormSection>

      {!isEdit &&
        (() => {
          const warnings: string[] = [];
          if (images.length === 0) warnings.push("No photos yet — listings with photos sell faster.");
          if (usedNeedsGrade && !grade) warnings.push("No grade set for a used part — buyers weight this heavily.");
          if (shippingMode === "flat" && (!shipping.trim() || Number(shipping) === 0)) warnings.push("Shipping is $0 — confirm that's intentional, not just unset.");
          const show = warnings.length > 0 || !canPublish;
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
                {/* The one real blocker leads: money needs somewhere to go. */}
                {!canPublish && (
                  <li>
                    <b className="text-ink">Payouts aren&apos;t set up — required to publish.</b>{" "}
                    <Link href="/settings#payments" className="jumplink">
                      Set up payouts →
                    </Link>
                  </li>
                )}
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <p className="field__hint mt-1">
                {canPublish
                  ? "These are nudges, not blockers — you can still publish or save a draft as-is."
                  : "Drafts save any time — publishing unlocks once payouts are ready."}
              </p>
            </div>
                </motion.div>
              )}
            </AnimatePresence>
          );
        })()}

      {state.error && (
        <p role="alert" aria-live="polite" className="field__err">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" aria-live="polite" className="chip chip--ok">
          {state.ok}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="spec-note !mt-0 !border-t-0 !pt-0">
          {isEdit ? (
            <>Changes go live on the market immediately.</>
          ) : (
            <b>Save a draft and nothing reaches the market until you publish.</b>
          )}
        </span>
        <span className="flex flex-wrap gap-2">
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
          {/* Gated publish stays focusable (a `disabled` button vanishes from
              the tab order, so its checklist reference would never be
              announced) — aria-disabled + a guarded click instead. */}
          <Button
            type="submit"
            variant="live"
            disabled={pending || uploading}
            aria-disabled={!isEdit && !canPublish ? true : undefined}
            aria-describedby={!isEdit && !canPublish ? "publish-checklist" : undefined}
            onClick={(e) => {
              if (!isEdit && !canPublish) e.preventDefault();
            }}
            className={!isEdit && !canPublish ? "opacity-55 cursor-not-allowed" : undefined}
          >
            {pending
              ? isEdit
                ? "Saving…"
                : "Publishing…"
              : isEdit
                ? "Save changes"
                : "Publish to market"}
          </Button>
        </span>
      </div>
    </form>
  );
}
