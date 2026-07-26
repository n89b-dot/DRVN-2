"use client";

import { useRef, useState, useTransition } from "react";

import type { CarImage } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";
import { Media } from "@/components/ui";

import { addCarImage, deleteCarImage } from "../../actions";

export function GalleryManager({
  carId,
  userId,
  images,
}: {
  carId: string;
  userId: string;
  images: CarImage[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [, startTransition] = useTransition();

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setUploading(true);
    const supabase = createClient();

    try {
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) {
          setError(`${file.name} is over 10MB.`);
          continue;
        }
        const ext = file.name.split(".").pop() ?? "jpg";
        const path = `${userId}/${carId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("car-images")
          .upload(path, file, { contentType: file.type });
        if (uploadError) {
          setError(uploadError.message);
          continue;
        }
        const {
          data: { publicUrl },
        } = supabase.storage.from("car-images").getPublicUrl(path);
        const result = await addCarImage(carId, publicUrl);
        if (result.error) setError(result.error);
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <section className="rounded-card border border-border bg-surface p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-text-primary">Gallery</h2>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="rounded-pill border border-border px-4 py-2 text-sm text-text-secondary transition hover:text-text-primary"
        >
          {uploading ? "Uploading…" : "Upload photos"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {images.length > 0 ? (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {images.map((image) => (
            <div key={image.id} className="group relative">
              <Media src={image.url} alt={image.alt ?? "Car photo"} className="h-24 w-full rounded-tile" />
              <form
                action={(fd) => startTransition(() => deleteCarImage(fd))}
                className="absolute right-1.5 top-1.5 opacity-0 transition group-hover:opacity-100"
              >
                <input type="hidden" name="image_id" value={image.id} />
                <input type="hidden" name="car_id" value={carId} />
                <button
                  type="submit"
                  className="rounded-full bg-black/70 px-2 py-0.5 text-xs text-white"
                  aria-label="Delete photo"
                >
                  ✕
                </button>
              </form>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-text-muted">No photos yet. The first upload becomes the cover.</p>
      )}
    </section>
  );
}
