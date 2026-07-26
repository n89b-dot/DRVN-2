"use client";

import { useActionState, useRef, useState } from "react";

import { CATEGORIES, CONDITIONS } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/client";

import { createListing, type SellState } from "./actions";

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
        <span className="font-mono text-xs tracking-[0.1em] text-live">
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

export function SellForm({
  cars,
  userId,
}: {
  cars: { id: string; name: string }[];
  userId: string;
}) {
  const [state, action, pending] = useActionState<SellState, FormData>(createListing, {});
  const [category, setCategory] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const subcategories = CATEGORIES.find((c) => c.slug === category)?.subcategories ?? [];

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
        setImageUrls((u) => [...u, publicUrl]);
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <form action={action} className="deck !pb-0">
      <input type="hidden" name="image_urls" value={JSON.stringify(imageUrls)} />

      <Section step={1} title="The part — what you're releasing">
        <div className="field !mb-0">
          <span className="microlabel">Title</span>
          <input
            name="title"
            required
            placeholder="e.g. 034 High-Flow Downpipe for B9 S4"
            className="ctl max-w-none"
          />
          <span className="field__hint">Clear titles sell faster — brand, model, then the car it fits.</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
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
          </label>
          <label className="field !mb-0">
            <span className="microlabel">Subcategory — optional</span>
            <select name="subcategory" defaultValue="" className="ctl max-w-none" disabled={!subcategories.length}>
              <option value="">—</option>
              {subcategories.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field !mb-0 max-w-[50%]">
          <span className="microlabel">Condition</span>
          <select name="condition" defaultValue="used" className="ctl max-w-none">
            {CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field !mb-0">
          <span className="microlabel">Description</span>
          <textarea
            name="description"
            rows={4}
            placeholder="What is it, why is it coming off, anything a buyer should know."
            className="ctl"
          />
        </label>
      </Section>

      <Section step={2} title="Photos" hint="Up to 12 — the first frame is the cover. Honest beats flattering.">
        <div className="thumbs !mt-0">
          {imageUrls.map((url, index) => (
            <span key={url} className="thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Photo ${index + 1}`} />
              {index === 0 && <span className="thumb__tag">Cover</span>}
              <button
                type="button"
                onClick={() => setImageUrls((u) => u.filter((x) => x !== url))}
                className="thumb__x"
                aria-label="Remove photo"
              >
                ✕
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="thumb thumb--ghost grid place-items-center font-mono text-xs uppercase tracking-[0.1em] text-dim"
          >
            {uploading ? "Uploading…" : "+ Add"}
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
        {uploadError && (
          <p className="field__err" style={{ display: "flex" }}>
            {uploadError}
          </p>
        )}
      </Section>

      <Section
        step={3}
        title="Where it came from"
        hint="Optional — linking a car in your garage attaches the sheet's context to the listing."
      >
        <select name="source_car_id" defaultValue="" className="ctl max-w-none">
          <option value="">Bought spare / never fitted — no car sheet behind it</option>
          {cars.map((car) => (
            <option key={car.id} value={car.id}>
              Off my sheet — {car.name}
            </option>
          ))}
        </select>
      </Section>

      <Section
        step={4}
        title="Fitment — your words"
        hint="Seller-stated, shown as informational. Never a guarantee."
      >
        <textarea
          name="compatibility_notes"
          rows={3}
          placeholder='e.g. "Came off a 2019 B9 S4. Should fit B9/B9.5 S4/S5, verify for RS5."'
          className="ctl"
        />
      </Section>

      <Section step={5} title="Price & location">
        <div className="grid grid-cols-2 gap-3">
          <label className="field !mb-0">
            <span className="microlabel">Asking price</span>
            <div className="ctl__prefix">
              <span>$</span>
              <input name="price" required inputMode="decimal" placeholder="0" className="ctl" />
            </div>
          </label>
          <label className="field !mb-0">
            <span className="microlabel">Location</span>
            <input name="location" placeholder="City, state" className="ctl max-w-none" />
          </label>
        </div>
      </Section>

      {state.error && (
        <p className="field__err" style={{ display: "flex" }}>
          {state.error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="spec-note !mt-0 !border-t-0 !pt-0">
          <b>Nothing reaches the market until you publish.</b>
        </span>
        <button type="submit" disabled={pending || uploading} className="btn btn--live">
          {pending ? "Publishing…" : "Publish to market"}
        </button>
      </div>
    </form>
  );
}
