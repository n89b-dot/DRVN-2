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
    <section className="tile">
      <div className="tile__head">
        <span className="microlabel microlabel--ink">Photos — first frame is the cover</span>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="btn btn--ghost"
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
      {error && (
        <p className="field__err mt-3" style={{ display: "flex" }}>
          {error}
        </p>
      )}
      {images.length > 0 ? (
        <div className="thumbs">
          {images.map((image) => (
            <div key={image.id} className="thumb group">
              <Media src={image.url} alt={image.alt ?? "Car photo"} className="h-full w-full" />
              <form
                action={(fd) => startTransition(() => deleteCarImage(fd))}
                className="absolute right-1 top-1 opacity-0 transition group-hover:opacity-100"
              >
                <input type="hidden" name="image_id" value={image.id} />
                <input type="hidden" name="car_id" value={carId} />
                <button
                  type="submit"
                  className="thumb__x"
                  aria-label="Delete photo"
                >
                  ✕
                </button>
              </form>
            </div>
          ))}
        </div>
      ) : (
        <p className="field__hint mt-4">No photos yet — the first upload becomes the cover.</p>
      )}
    </section>
  );
}
