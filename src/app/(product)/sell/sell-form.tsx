"use client";

import { useActionState, useRef, useState } from "react";

import { CATEGORIES, CONDITIONS } from "@/lib/marketplace/taxonomy";
import { isLowConfidence } from "@/lib/mods/parse";
import { createClient } from "@/lib/supabase/client";

import { createListing, updateListing, type SellState } from "./actions";

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
};

export function SellForm({
  cars,
  userId,
  listing,
  prefill,
}: {
  cars: { id: string; name: string }[];
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
  const [images, setImages] = useState<GalleryImage[]>(listing?.images ?? []);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const subcategories = CATEGORIES.find((c) => c.slug === category)?.subcategories ?? [];
  const money = (cents: number | null | undefined) =>
    cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);

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

  return (
    <form action={action} className="deck !pb-0">
      <input type="hidden" name="image_urls" value={JSON.stringify(images)} />
      {listing && <input type="hidden" name="id" value={listing.id} />}
      {prefill?.modItemId && (
        <input type="hidden" name="mod_item_id" value={prefill.modItemId} />
      )}

      <Section step={1} title="The part — what you're releasing">
        <div className="field !mb-0">
          <span className="microlabel">Title</span>
          <input
            name="title"
            required
            maxLength={140}
            defaultValue={listing?.title ?? prefill?.title ?? ""}
            placeholder="e.g. 034 High-Flow Downpipe for B9 S4"
            className="ctl max-w-none"
          />
          <span className="field__hint">
            Clear titles sell faster — brand, model, then the car it fits.
          </span>
        </div>
        {/* .field--row collapses to one column on small screens; a bare
            grid-cols-2 kept these side by side at 375px. */}
        <div className="field--row">
          <label className="field !mb-0">
            <span className="microlabel">Category</span>
            <select
              name="category"
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="ctl max-w-none"
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
            {!listing &&
              prefill?.modConfidence !== undefined &&
              prefill?.modConfidence !== null &&
              isLowConfidence(prefill.modConfidence) && (
                <span className="field__hint">
                  Guessed from a low-confidence parse of the build line — check it.
                </span>
              )}
          </label>
          <label className="field !mb-0">
            <span className="microlabel">Subcategory — optional</span>
            <select
              name="subcategory"
              defaultValue={listing?.subcategory ?? prefill?.subcategory ?? ""}
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
          </label>
        </div>
        <div className="field--row">
          <label className="field !mb-0">
            <span className="microlabel">Condition</span>
            <select
              name="condition"
              defaultValue={listing?.condition ?? "used"}
              className="ctl max-w-none"
            >
              {CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field !mb-0">
            <span className="microlabel">Part number — optional</span>
            <input
              name="part_number"
              maxLength={120}
              defaultValue={listing?.part_number ?? prefill?.partNumber ?? ""}
              placeholder="e.g. CP9660-2S4"
              className="ctl max-w-none"
            />
            <span className="field__hint">
              What a buyer cross-references. Seller-entered, not verified.
            </span>
          </label>
        </div>
        <label className="field !mb-0">
          <span className="microlabel">Description</span>
          <textarea
            name="description"
            rows={4}
            maxLength={8000}
            defaultValue={listing?.description ?? ""}
            placeholder="What is it, why is it coming off, anything a buyer should know."
            className="ctl !max-w-none"
          />
        </label>
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
        title="Fitment — your words"
        hint="Seller-stated, shown as informational. Never a guarantee."
      >
        <textarea
          name="compatibility_notes"
          rows={3}
          maxLength={2000}
          defaultValue={listing?.compatibility_notes ?? ""}
          placeholder='e.g. "Came off a 2019 B9 S4. Should fit B9/B9.5 S4/S5, verify for RS5."'
          className="ctl !max-w-none"
        />
      </Section>

      <Section step={5} title="Price, shipping & location">
        <div className="field--row">
          <label className="field !mb-0">
            <span className="microlabel">Asking price</span>
            <div className="ctl__prefix">
              <span>$</span>
              <input
                name="price"
                required
                inputMode="decimal"
                defaultValue={money(listing?.price_cents)}
                placeholder="0"
                className="ctl"
              />
            </div>
          </label>
          <label className="field !mb-0">
            <span className="microlabel">Shipping — flat rate</span>
            <div className="ctl__prefix">
              <span>$</span>
              <input
                name="shipping"
                inputMode="decimal"
                defaultValue={money(listing?.shipping_cents ?? 0)}
                placeholder="0"
                className="ctl"
              />
            </div>
            <span className="field__hint">Leave at 0 for free shipping.</span>
          </label>
        </div>
        <div className="field--row">
          <label className="field !mb-0">
            <span className="microlabel">Lowest offer you&apos;d read — optional</span>
            <div className="ctl__prefix">
              <span>$</span>
              <input
                name="offer_floor"
                inputMode="decimal"
                defaultValue={money(listing?.offer_floor_cents)}
                placeholder="—"
                className="ctl"
              />
            </div>
            <span className="field__hint">Offers below this are declined automatically.</span>
          </label>
          <label className="field !mb-0">
            <span className="microlabel">Location</span>
            <input
              name="location"
              defaultValue={listing?.location ?? ""}
              placeholder="City, state"
              className="ctl max-w-none"
            />
          </label>
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
