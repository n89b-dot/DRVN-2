"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button, ButtonLink } from "@/components/ui";
import { createQuickPost } from "@/app/(product)/garage/actions";
import { uploadImages } from "@/lib/media-upload";

import { PartPicker, type TaggablePart } from "./part-picker";
import { handOffToComposer } from "./recovery";

export type QuickPostCar = { id: string; name: string };

/**
 * W-1 — the quick box: pick a car, one to six photos, a caption, Post.
 *
 * It exists because the full editor is the right tool for a long update and
 * the wrong one for "new wheels turned up". Everything about it is the short
 * path: no title, no blocks, no draft.
 *
 * **It never touches a saved draft** — the release-blocking contract. The
 * server action uses the database's `quick` write mode, which returns before
 * the draft lookup that publishing from the editor does. The handoff below
 * is the other half: with no draft, "Write a full update" carries this
 * content over as the draft; with one, the link says "Continue your draft"
 * and nothing is merged, because merging two pieces of writing on somebody's
 * behalf is not a thing software should do.
 */
export function QuickPost({
  cars,
  userId,
  initials,
  hasDraftFor,
  parts,
}: {
  cars: QuickPostCar[];
  userId: string;
  initials: string;
  /** Car ids that already have an unpublished draft. */
  hasDraftFor: string[];
  /** The author's own active listings, for W-3's part picker. */
  parts: TaggablePart[];
}) {
  const router = useRouter();
  const [carId, setCarId] = useState(cars[0]?.id ?? "");
  const [caption, setCaption] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [tagged, setTagged] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  // One operation id per composed post: a lost response replays instead of
  // double-posting, and a new id is minted only after a successful send.
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());

  // W-5: with no cars at all the box still works, provided a part is tagged
  // — someone between cars is exactly who the carless post is for. With no
  // cars AND nothing to sell there is nothing to post about yet — so the box
  // says what comes first (the bar's Post button lands here) rather than
  // showing an empty tile.
  if (!cars.length && !parts.length) {
    return (
      <div className="composerlite">
        <p className="text-body">Add your car — or list a part — to start posting.</p>
        <p className="spec-note">Every post is about a car or a part, with a photo.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ButtonLink href="/garage" variant="live">
            Add your car
          </ButtonLink>
          <ButtonLink href="/sell" variant="ghost">
            List a part
          </ButtonLink>
        </div>
      </div>
    );
  }
  const draftHere = Boolean(carId) && hasDraftFor.includes(carId);
  const carless = !carId;

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setUploading(true);
    try {
      const result = await uploadImages({
        files: Array.from(files).slice(0, 6 - photos.length),
        bucket: "activity-images",
        pathPrefix: `${userId}/${carId || "no-car"}`,
        normalize: true,
      });
      setPhotos((p) => [...p, ...result.uploaded.map((u) => u.url)].slice(0, 6));
      if (result.failed.length) setError("Some photos couldn't be added.");
    } finally {
      setUploading(false);
    }
  }

  function post() {
    setError(null);
    if (carless && !tagged.length) {
      setError("Pick a car, or tag a part this post is about.");
      return;
    }
    startTransition(async () => {
      const formData = new FormData();
      formData.set("car_id", carId);
      formData.set("operation_id", operationId);
      formData.set("caption", caption);
      formData.set("photos", photos.join("\n"));
      formData.set("listing_ids", tagged.join(","));
      const result = await createQuickPost({}, formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setCaption("");
      setPhotos([]);
      setTagged([]);
      setOperationId(crypto.randomUUID());
      if (result?.href) router.push(result.href);
      else router.refresh();
    });
  }

  const busy = pending || uploading;

  return (
    <div className="composerlite">
      <div className="composerlite__ask flex w-full items-start gap-3">
        <span className="monogram monogram--sm" aria-hidden="true">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <label htmlFor="quick-caption" className="sr-only">
            What&apos;s new?
          </label>
          <textarea
            id="quick-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder={
              !cars.length
                ? "What are you selling?"
                : cars.length === 1
                  ? `What's new with ${cars[0].name}?`
                  : "What's new with your build?"
            }
            className="ctl max-w-none"
          />
        </div>
      </div>

      {photos.length > 0 && (
        <div className="quickpost__photos" aria-label="Photos on this post">
          {photos.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={url} src={url} alt="" className="quickpost__thumb" />
          ))}
        </div>
      )}

      <div className="composerlite__cars">
        {cars.length > 0 && (
          <>
            <label htmlFor="quick-car" className="sr-only">
              Which car?
            </label>
            <select
              id="quick-car"
              value={carId}
              onChange={(e) => setCarId(e.target.value)}
              className="ctl w-auto"
            >
              {cars.map((car) => (
                <option key={car.id} value={car.id}>
                  {car.name}
                </option>
              ))}
              {/* W-5. Last, not first: most posts are about a car, and this
                  is the exception rather than the default. */}
              <option value="">No car — about a part</option>
            </select>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void addPhotos(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          onClick={() => fileRef.current?.click()}
          disabled={busy || photos.length >= 6}
        >
          {uploading ? "Adding…" : photos.length ? `Photos (${photos.length})` : "Add photos"}
        </Button>
        <PartPicker parts={parts} carId={carId} selected={tagged} onChange={setTagged} />
        <Button variant="live" onClick={post} loading={pending} pendingLabel="Posting…" disabled={busy}>
          Post
        </Button>
      </div>

      {error && (
        <p role="alert" className="field__err">
          {error}
        </p>
      )}

      <p className="spec-note composerlite__hint">
        Every post needs a photo.{" "}
        {carless ? (
          <span>Tag the part it&apos;s about.</span>
        ) : draftHere ? (
          <Link href={`/garage/${carId}/update/new`} className="jumplink">
            Continue your draft →
          </Link>
        ) : (
          /* W-1: what's typed here goes with you. It travels in the
             composer's own browser copy, never in the URL. */
          <Link
            href={`/garage/${carId}/update/new`}
            className="jumplink"
            onClick={() => handOffToComposer(carId, caption, photos)}
          >
            Write a full update →
          </Link>
        )}
      </p>
    </div>
  );
}
