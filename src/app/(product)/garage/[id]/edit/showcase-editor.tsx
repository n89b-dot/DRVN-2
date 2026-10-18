"use client";

import { useState, useTransition } from "react";

import type { CarHotspot, CarImage, ModItem } from "@/lib/database.types";
import { Button, TileHead } from "@/components/ui";
import { cx } from "@/lib/format";
import { useHydrated } from "@/lib/hooks/useHydrated";

import { saveShowcase, type ShowcasePinInput } from "../../actions";

/**
 * Showcase editor (brief §U) — an OPTIONAL advanced section: pick one photo,
 * click to pin parts on it, each pin naming a build entry. Deliberately
 * bounded (one image, 8 pins) so the public gallery stays clean; the pins
 * appear on the build page behind an "Explore this build" toggle.
 */

type Draft = { key: string; x: number; y: number; modItemId: string | null; label: string };

export function ShowcaseEditor({
  carId,
  images,
  mods,
  initial,
}: {
  carId: string;
  images: CarImage[];
  mods: ModItem[];
  initial: CarHotspot[];
}) {
  // Controlled fields must not replace what was typed before hydration
  // (see useHydrated): they stay disabled until the page is live.
  const ready = useHydrated();
  const [imageUrl, setImageUrl] = useState(initial[0]?.image_url ?? images[0]?.url ?? "");
  const [pins, setPins] = useState<Draft[]>(
    initial.map((pin) => ({
      key: pin.id,
      x: pin.x,
      y: pin.y,
      modItemId: pin.mod_item_id,
      label: pin.label,
    })),
  );
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const modLabel = (mod: ModItem) =>
    [mod.brand, mod.product].filter(Boolean).join(" ") || mod.raw_text || "Build entry";

  if (images.length === 0) return null;

  const save = () => {
    setStatus(null);
    const payload: ShowcasePinInput[] = pins.map((pin) => ({
      x: pin.x,
      y: pin.y,
      modItemId: pin.modItemId,
      label: pin.label,
    }));
    startTransition(async () => {
      const result = await saveShowcase(carId, imageUrl, payload);
      setStatus(result.error ?? result.ok ?? null);
    });
  };

  return (
    <section className="tile">
      <fieldset disabled={!ready} className="contents">
      <TileHead
        label="Showcase — optional"
        end={<span className="kv">{pins.length}/8 pins</span>}
      />
      <p className="field__hint max-w-[62ch]">
        Pick one photo and pin the parts on it — visitors get an &ldquo;Explore this
        build&rdquo; toggle on the public page. The rest of the gallery stays clean.
      </p>

      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Showcase photo">
        {images.slice(0, 8).map((image) => (
          <button
            key={image.id}
            type="button"
            role="radio"
            aria-checked={image.url === imageUrl}
            className={cx(
              "h-14 w-20 overflow-hidden rounded-ctl border-2",
              image.url === imageUrl ? "border-[var(--live)]" : "border-transparent",
            )}
            onClick={() => {
              if (image.url !== imageUrl) {
                setImageUrl(image.url);
                setPins([]);
              }
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.url} alt={image.alt ?? "Car photo"} className="h-full w-full object-cover" />
          </button>
        ))}
      </div>

      {imageUrl && (
        <button
          type="button"
          className="relative mt-3 block w-full cursor-crosshair overflow-hidden rounded-ctl p-0"
          aria-label="Click the photo to add a pin"
          onClick={(event) => {
            if (pins.length >= 8) return;
            const rect = event.currentTarget.getBoundingClientRect();
            setPins((current) => [
              ...current,
              {
                key: crypto.randomUUID(),
                x: (event.clientX - rect.left) / rect.width,
                y: (event.clientY - rect.top) / rect.height,
                modItemId: mods[0]?.id ?? null,
                label: mods[0] ? modLabel(mods[0]) : "",
              },
            ]);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="Showcase" className="block w-full" draggable={false} />
          {pins.map((pin, index) => (
            <span
              key={pin.key}
              aria-hidden="true"
              className="pointer-events-none absolute grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[var(--scrim)] font-mono text-[11px] text-[var(--on-ink)]"
              style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
            >
              {index + 1}
            </span>
          ))}
        </button>
      )}

      {pins.length > 0 && (
        <div className="mt-3 grid gap-2">
          {pins.map((pin, index) => (
            <div key={pin.key} className="flex flex-wrap items-center gap-2">
              <span className="kv w-8">{index + 1}</span>
              {mods.length > 0 && (
                <select
                  className="ctl w-56"
                  aria-label={`Pin ${index + 1} build entry`}
                  value={pin.modItemId ?? ""}
                  onChange={(event) => {
                    const mod = mods.find((m) => m.id === event.target.value);
                    setPins((current) =>
                      current.map((p) =>
                        p.key === pin.key
                          ? { ...p, modItemId: mod?.id ?? null, label: mod ? modLabel(mod) : p.label }
                          : p,
                      ),
                    );
                  }}
                >
                  <option value="">Custom label…</option>
                  {mods.map((mod) => (
                    <option key={mod.id} value={mod.id}>
                      {modLabel(mod)}
                    </option>
                  ))}
                </select>
              )}
              <input
                className="ctl min-w-0 flex-1"
                aria-label={`Pin ${index + 1} label`}
                maxLength={80}
                value={pin.label}
                onChange={(event) =>
                  setPins((current) =>
                    current.map((p) => (p.key === pin.key ? { ...p, label: event.target.value } : p)),
                  )
                }
              />
              <Button
                variant="ghost"
                aria-label={`Remove pin ${index + 1}`}
                onClick={() => setPins((current) => current.filter((p) => p.key !== pin.key))}
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="live" onClick={save} loading={pending} pendingLabel="Saving…">
          Save showcase
        </Button>
        {initial.length > 0 && pins.length === 0 && (
          <span className="text-micro text-dim">Saving with no pins clears the showcase.</span>
        )}
        {status && (
          <span className="text-micro text-dim" role="status">
            {status}
          </span>
        )}
      </div>
      </fieldset>
    </section>
  );
}
