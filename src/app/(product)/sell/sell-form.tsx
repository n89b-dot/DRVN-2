"use client";

import { useActionState, useRef, useState } from "react";

import { CATEGORIES, CONDITIONS } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/client";

import { createListing, type SellState } from "./actions";

const inputClass =
  "h-11 w-full rounded-input border border-border bg-app px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent";

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
    <section className="rounded-card border border-border bg-surface p-6">
      <div className="flex items-baseline gap-3">
        <span className="text-xs font-bold text-accent">{String(step).padStart(2, "0")}</span>
        <div>
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-text-muted">{hint}</p>}
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
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="image_urls" value={JSON.stringify(imageUrls)} />

      <Section step={1} title="The basics">
        <input name="title" required placeholder="Title (e.g. 034 High-Flow Downpipe for B9 S4)" className={inputClass} />
        <div className="grid grid-cols-2 gap-3">
          <select
            name="category"
            required
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={`${inputClass} ${category ? "" : "text-text-muted"}`}
          >
            <option value="" disabled>
              Category
            </option>
            {CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
          <select name="subcategory" defaultValue="" className={inputClass} disabled={!subcategories.length}>
            <option value="">Subcategory (optional)</option>
            {subcategories.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <select name="condition" defaultValue="used" className={inputClass}>
            {CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <textarea
          name="description"
          rows={4}
          placeholder="Description — what is it, why are you selling, anything a buyer should know."
          className="w-full resize-y rounded-input border border-border bg-app px-3 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
        />
      </Section>

      <Section step={2} title="Photos" hint="Up to 12. The first is your cover.">
        <div className="flex flex-wrap gap-2">
          {imageUrls.map((url, index) => (
            <div key={url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Photo ${index + 1}`} className="h-20 w-28 rounded-tile object-cover" />
              <button
                type="button"
                onClick={() => setImageUrls((u) => u.filter((x) => x !== url))}
                className="absolute right-1 top-1 rounded-full bg-black/70 px-1.5 text-xs text-white"
                aria-label="Remove photo"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="grid h-20 w-28 place-items-center rounded-tile border border-dashed border-border text-sm text-text-muted transition hover:border-text-muted hover:text-text-secondary"
          >
            {uploading ? "Uploading…" : "+ Add"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
        </div>
        {uploadError && <p className="text-sm text-red-400">{uploadError}</p>}
      </Section>

      <Section
        step={3}
        title="Which car is this from?"
        hint="Optional — links the listing to a car in your garage for source-car context."
      >
        <select name="source_car_id" defaultValue="" className={inputClass}>
          <option value="">Not from a car in my garage</option>
          {cars.map((car) => (
            <option key={car.id} value={car.id}>
              {car.name}
            </option>
          ))}
        </select>
      </Section>

      <Section
        step={4}
        title="Compatibility notes"
        hint="Freeform notes from you as the seller — shown as informational, never a fitment guarantee."
      >
        <textarea
          name="compatibility_notes"
          rows={3}
          placeholder='e.g. "Came off a 2019 B9 S4. Should fit B9/B9.5 S4/S5, verify for RS5."'
          className="w-full resize-y rounded-input border border-border bg-app px-3 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
        />
      </Section>

      <Section step={5} title="Price & location">
        <div className="grid grid-cols-2 gap-3">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">$</span>
            <input
              name="price"
              required
              inputMode="decimal"
              placeholder="0"
              className={`${inputClass} pl-7`}
            />
          </div>
          <input name="location" placeholder="Location (city, state)" className={inputClass} />
        </div>
      </Section>

      {state.error && <p className="text-sm text-red-400">{state.error}</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending || uploading}
          className="rounded-pill bg-accent px-8 py-3 text-sm font-semibold text-white transition hover:bg-accent/90"
        >
          {pending ? "Publishing…" : "Publish listing"}
        </button>
      </div>
    </form>
  );
}
