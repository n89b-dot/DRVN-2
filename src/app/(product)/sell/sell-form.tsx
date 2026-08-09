"use client";

import { useActionState, useRef, useState } from "react";

import { checklistFor, GRADES, type ChecklistAnswer } from "@/lib/marketplace/grading";
import { CATEGORIES, CONDITIONS } from "@/lib/marketplace/taxonomy";
import { isLowConfidence } from "@/lib/mods/parse";
import { createClient } from "@/lib/supabase/client";

import { createListing, updateListing, type SellState } from "./actions";
import { FitmentPicker, type FitmentRow } from "./fitment-picker";

function Section({
  step,
  title,
  hint,
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="tile">
      <div className="flex items-baseline gap-3">
        {/* Step numerals are structure, not live state — signal red is reserved
            for things happening now. */}
        <span className="font-mono text-xs tracking-[0.1em] text-dim">
          {String(step).padStart(2, "0")}
        </span>
        <div>
          <h2 className="text-[16.5px] font-semibold tracking-[-0.01em]">{title}</h2>
          {hint && <p className="field__hint mt-0.5">{hint}</p>}
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-3">{children}</div>
    </section>
  );
}

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
  offer_floor_cents: number | null;
  allows_collection: boolean;
  location: string | null;
  compatibility_notes: string | null;
  source_car_id: string | null;
  status: string;
  images: GalleryImage[];
  fitments: FitmentRow[];
};

export function SellForm({
  cars,
  makes,
  userId,
  listing,
  prefill,
}: {
  cars: { id: string; name: string }[];
  /** Canonical make names for the fitment picker's suggestions. */
  makes: string[];
  userId: string;
  /** Present when editing an existing listing. */
  listing?: ListingDraft;
  /** Pre-fill from "release a part off this car". */
  prefill?: {
    carId?: string;
    title?: string;
    category?: string;
    subcategory?: string;
    modItemId?: string;
    partNumber?: string;
    /** Parser confidence carried from the mod line, for the guess note below —
     *  listings have no confidence column, so this never reaches the server. */
    modConfidence?: number | null;
  };
}) {
  const isEdit = Boolean(listing);
  const [state, action, pending] = useActionState<SellState, FormData>(
    isEdit ? updateListing : createListing,
    {}
  );
  const [category, setCategory] = useState(listing?.category ?? prefill?.category ?? "");
  const [subcategory, setSubcategory] = useState(
    listing?.subcategory ?? prefill?.subcategory ?? ""
  );
  const [condition, setCondition] = useState(listing?.condition ?? "used");
  const [images, setImages] = useState<GalleryImage[]>(listing?.images ?? []);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const subcategories = CATEGORIES.find((c) => c.slug === category)?.subcategories ?? [];
  const money = (cents: number | null | undefined) =>
    cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);

  // Completeness + validation-summary state. Price/shipping are lifted from
  // uncontrolled defaultValue inputs so the checklist and readiness note can
  // read them live, without re-plumbing the rest of the form.
  const [grade, setGrade] = useState(listing?.grade ?? "");
  const [attestAccurate, setAttestAccurate] = useState(false);
  const [price, setPrice] = useState(money(listing?.price_cents));
  const [shipping, setShipping] = useState(money(listing?.shipping_cents ?? 0));
  const [fitmentCount, setFitmentCount] = useState(listing?.fitments?.length ?? 0);
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

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploadError(null);
    setUploading(true);
    const supabase = createClient();
    try {
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) {
          setUploadError(`${file.name} is over 10MB.`);
          continue;
        }
        if (!file.type.startsWith("image/")) {
          setUploadError(`${file.name} isn't an image.`);
          continue;
        }
        const ext = file.name.split(".").pop() ?? "jpg";
        const path = `${userId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage
          .from("listing-images")
          .upload(path, file, { contentType: file.type });
        if (error) {
          setUploadError(error.message);
          continue;
        }
        const {
          data: { publicUrl },
        } = supabase.storage.from("listing-images").getPublicUrl(path);
        setImages((u) => [...u, { url: publicUrl, alt: null }]);
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
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
    setImages((current) => current.filter((_, i) => i !== index));
  }

  function updateAlt(index: number, alt: string) {
    setImages((current) => current.map((img, i) => (i === index ? { ...img, alt } : img)));
  }

  const errorEntries = Object.entries(fieldErrors);

  return (
    <form
      action={(formData) => {
        const errors = validate(formData);
        if (Object.keys(errors).length) {
          setFieldErrors(errors);
          return;
        }
        setFieldErrors({});
        action(formData);
      }}
      className="deck !pb-0"
    >
      <input type="hidden" name="image_urls" value={JSON.stringify(images)} />
      {listing && <input type="hidden" name="id" value={listing.id} />}
      {prefill?.modItemId && (
        <input type="hidden" name="mod_item_id" value={prefill.modItemId} />
      )}

      {errorEntries.length > 0 && (
        <div role="alert" aria-live="assertive" className="tile !mb-0 text-live">
          <p className="font-semibold">Fix these before submitting:</p>
          <ul className="mt-1 list-disc pl-5 text-[13.5px]">
            {errorEntries.map(([field, message]) => (
              <li key={field}>
                <a href={`#${fieldAnchors[field] ?? field}`} className="jumplink underline">
                  {fieldLabels[field] ?? field}
                </a>
                {" — "}
                {message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Completeness checklist — a lightweight, live-updating nudge toward a
          strong listing. Nothing here blocks submit; the hard requirements
          are enforced above and on the server. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-[0.08em] text-dim">
        <span>Photos {images.length > 0 ? "✓" : "—"}</span>
        <span aria-hidden="true">·</span>
        <span>Condition {!usedNeedsGrade || grade ? "✓" : "—"}</span>
        <span aria-hidden="true">·</span>
        <span>Fitment {fitmentCount > 0 ? "✓" : "—"}</span>
        <span aria-hidden="true">·</span>
        <span>Shipping {shipping.trim() !== "" ? "✓" : "—"}</span>
      </div>

      <Section step={1} title="The part — what you're releasing">
        <div className="field !mb-0">
          <label htmlFor="sell-title" className="microlabel">Title</label>
          <input id="sell-title"
            name="title"
            required
            maxLength={140}
            defaultValue={listing?.title ?? prefill?.title ?? ""}
            placeholder="e.g. 034 High-Flow Downpipe for B9 S4"
            className="ctl max-w-none"
            aria-describedby={fieldErrors.title ? "sell-title-error" : undefined}
            aria-invalid={fieldErrors.title ? true : undefined}
          />
          {fieldErrors.title && (
            <p id="sell-title-error" className="field__err">
              {fieldErrors.title}
            </p>
          )}
          <span className="field__hint">
            Clear titles sell faster — brand, model, then the car it fits.
          </span>
        </div>
        {/* .field--row collapses to one column on small screens; a bare
            grid-cols-2 kept these side by side at 375px. */}
        <div className="field--row">
          <div className="field !mb-0">
            <label htmlFor="sell-category" className="microlabel">Category</label>
            <select id="sell-category"
              name="category"
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="ctl max-w-none"
              aria-describedby={fieldErrors.category ? "sell-category-error" : undefined}
              aria-invalid={fieldErrors.category ? true : undefined}
            >
              <option value="" disabled>
                Choose…
              </option>
              {CATEGORIES.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.label}
                </option>
              ))}
            </select>
            {fieldErrors.category && (
              <p id="sell-category-error" className="field__err">
                {fieldErrors.category}
              </p>
            )}
            {!listing &&
              prefill?.modConfidence !== undefined &&
              prefill?.modConfidence !== null &&
              isLowConfidence(prefill.modConfidence) && (
                <span className="field__hint">
                  Guessed from a low-confidence parse of the build line — check it.
                </span>
              )}
          </div>
          <div className="field !mb-0">
            <label htmlFor="sell-subcategory" className="microlabel">Subcategory — optional</label>
            <select id="sell-subcategory"
              name="subcategory"
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
              className="ctl max-w-none"
              disabled={!subcategories.length}
            >
              <option value="">—</option>
              {subcategories.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field--row">
          <div className="field !mb-0">
            <label htmlFor="sell-condition" className="microlabel">Condition</label>
            <select id="sell-condition"
              name="condition"
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              className="ctl max-w-none"
            >
              {CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field !mb-0">
            <label htmlFor="sell-part_number" className="microlabel">Part number — optional</label>
            <input id="sell-part_number"
              name="part_number"
              maxLength={120}
              defaultValue={listing?.part_number ?? prefill?.partNumber ?? ""}
              placeholder="e.g. CP9660-2S4"
              className="ctl max-w-none"
            />
            <span className="field__hint">
              What a buyer cross-references. Seller-entered, not verified.
            </span>
          </div>
        </div>
        {/* Grade + checklist: dispute prevention (0024). Only for used parts —
            "new" already says everything a grade would. The checklist follows
            the category, so a turbo gets asked about shaft play and a wheel
            about curb rash; every answer renders on the listing and freezes
            onto the order as the contract. */}
        {condition !== "new" && (
          <>
            <div className="field !mb-0">
              <label htmlFor="sell-grade" className="microlabel">Grade — how honest sellers price</label>
              <select id="sell-grade"
                name="grade"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="ctl max-w-none"
              >
                <option value="">Not graded</option>
                {GRADES.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label} — {g.meaning}
                  </option>
                ))}
              </select>
            </div>
            {category && (
              <fieldset className="field !mb-0">
                <legend className="microlabel">
                  Condition checklist — each answer shows on the listing
                </legend>
                <div className="mt-1 flex flex-col gap-2">
                  {checklistFor(category, subcategory || null).map((q) => (
                    <div key={q.key} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[13.5px]">{q.label}</span>
                      <span className="flex gap-3" role="radiogroup" aria-label={q.label}>
                        {(["yes", "no", "unknown"] as const).map((answer) => (
                          <label key={answer} className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.08em] text-dim">
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
              <label className="flex items-start gap-2 text-[13px]">
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
        <div className="field !mb-0">
          <label htmlFor="sell-description" className="microlabel">Description</label>
          <textarea id="sell-description"
            name="description"
            rows={4}
            maxLength={8000}
            defaultValue={listing?.description ?? ""}
            placeholder="What is it, why is it coming off, anything a buyer should know."
            className="ctl !max-w-none"
          />
        </div>
      </Section>

      <Section
        step={2}
        title="Photos"
        hint="Up to 12 — the first frame is the cover. Reorder, set a cover, or add alt text below."
      >
        <div className="thumbs !mt-0">
          {images.map((img, index) => (
            <div key={img.url} className="flex flex-col gap-1.5">
              <span className="thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.alt || `Photo ${index + 1}`} />
                {index === 0 && <span className="thumb__tag">Cover</span>}
                <button
                  type="button"
                  onClick={() => removeImage(index)}
                  className="thumb__x"
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
                  className="rounded-[6px] border border-[var(--dimline)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-dim transition hover:text-ink disabled:opacity-30"
                  aria-label={`Move photo ${index + 1} earlier`}
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => moveImage(index, 1)}
                  disabled={index === images.length - 1}
                  className="rounded-[6px] border border-[var(--dimline)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-dim transition hover:text-ink disabled:opacity-30"
                  aria-label={`Move photo ${index + 1} later`}
                >
                  →
                </button>
                {index !== 0 && (
                  <button
                    type="button"
                    onClick={() => makeCover(index)}
                    className="flex-1 truncate rounded-[6px] border border-[var(--dimline)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-dim transition hover:text-ink"
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
                className="ctl max-w-none !py-1 text-[12px]"
                aria-label={`Alt text for photo ${index + 1}`}
              />
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
        </div>
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
      </Section>

      <Section
        step={3}
        title="Where it came from"
        hint="Optional — linking a car in your garage attaches the sheet's context to the listing."
      >
        <select
          name="source_car_id"
          defaultValue={listing?.source_car_id ?? prefill?.carId ?? ""}
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
      </Section>

      <Section
        step={4}
        title="Fitment — what it fits"
        hint="Seller-stated, shown as informational. Never a guarantee."
      >
        <FitmentPicker
          makes={makes}
          initial={listing?.fitments ?? []}
          onCountChange={setFitmentCount}
        />
        <div className="field !mb-0">
          <label htmlFor="sell-compatibility_notes" className="microlabel">
            Notes — anything the rows can&apos;t say
          </label>
          <textarea
            id="sell-compatibility_notes"
            name="compatibility_notes"
            rows={3}
            maxLength={2000}
            defaultValue={listing?.compatibility_notes ?? ""}
            placeholder='e.g. "Needs the OEM bracket from a facelift car. Verify for RS5."'
            className="ctl !max-w-none"
          />
        </div>
      </Section>

      <Section step={5} title="Price, shipping & location">
        <div className="field--row">
          <div className="field !mb-0">
            <label htmlFor="sell-price" className="microlabel">Asking price</label>
            <div className="ctl__prefix">
              <span>$</span>
              <input id="sell-price"
                name="price"
                required
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0"
                className="ctl"
                aria-describedby={fieldErrors.price ? "sell-price-error" : undefined}
                aria-invalid={fieldErrors.price ? true : undefined}
              />
            </div>
            {fieldErrors.price && (
              <p id="sell-price-error" className="field__err">
                {fieldErrors.price}
              </p>
            )}
          </div>
          <div className="field !mb-0">
            <label htmlFor="sell-shipping" className="microlabel">Shipping — flat rate</label>
            <div className="ctl__prefix">
              <span>$</span>
              <input id="sell-shipping"
                name="shipping"
                inputMode="decimal"
                value={shipping}
                onChange={(e) => setShipping(e.target.value)}
                placeholder="0"
                className="ctl"
              />
            </div>
            <span className="field__hint">Leave at 0 for free shipping.</span>
          </div>
        </div>
        <div className="field--row">
          <div className="field !mb-0">
            <label htmlFor="sell-offer_floor" className="microlabel">Lowest offer you&apos;d read — optional</label>
            <div className="ctl__prefix">
              <span>$</span>
              <input id="sell-offer_floor"
                name="offer_floor"
                inputMode="decimal"
                defaultValue={money(listing?.offer_floor_cents)}
                placeholder="—"
                className="ctl"
              />
            </div>
            <span className="field__hint">Offers below this are declined automatically.</span>
          </div>
          <div className="field !mb-0">
            <label htmlFor="sell-location" className="microlabel">Location</label>
            <input id="sell-location"
              name="location"
              defaultValue={listing?.location ?? ""}
              placeholder="City, state"
              className="ctl max-w-none"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            name="allows_collection"
            defaultChecked={listing?.allows_collection ?? false}
            className="accent-live"
          />
          Buyers may collect in person
        </label>
      </Section>

      {!isEdit &&
        (() => {
          const warnings: string[] = [];
          if (images.length === 0) warnings.push("No photos yet — listings with photos sell faster.");
          if (usedNeedsGrade && !grade) warnings.push("No grade set for a used part — buyers weight this heavily.");
          if (!shipping.trim() || Number(shipping) === 0) warnings.push("Shipping is $0 — confirm that's intentional, not just unset.");
          if (!warnings.length) return null;
          return (
            <div role="status" aria-live="polite" className="tile !mb-0">
              <p className="microlabel microlabel--ink">Before you publish</p>
              <ul className="mt-1 list-disc pl-5 text-[13px] text-dim">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <p className="field__hint mt-1">
                These are nudges, not blockers — you can still publish or save a draft as-is.
              </p>
            </div>
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
            <button
              type="submit"
              name="save_draft"
              value="1"
              disabled={pending || uploading}
              className="btn btn--ghost"
            >
              Save draft
            </button>
          )}
          <button type="submit" disabled={pending || uploading} className="btn btn--live">
            {pending
              ? isEdit
                ? "Saving…"
                : "Publishing…"
              : isEdit
                ? "Save changes"
                : "Publish to market"}
          </button>
        </span>
      </div>
    </form>
  );
}
