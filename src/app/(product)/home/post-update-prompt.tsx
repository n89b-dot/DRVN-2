"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type CarOption = { id: string; name: string };

/**
 * Composer-entry on Home: avatar + the question, top-aligned under the tile
 * head. One car goes straight to the editor — the question names the car.
 * Several cars reveal their chips on tap (Campsite's suggestion-chip
 * pattern), and the note beneath the rule says what an update can carry.
 */
export function PostUpdatePrompt({ cars, initials }: { cars: CarOption[]; initials: string }) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);

  if (cars.length === 0) return null;
  const single = cars.length === 1;

  function onClick() {
    if (single) router.push(`/garage/${cars[0].id}/update/new`);
    else setPicking((p) => !p);
  }

  return (
    <div className="composerlite">
      <button
        type="button"
        onClick={onClick}
        aria-expanded={single ? undefined : picking}
        className="composerlite__ask flex w-full items-center gap-3 text-left"
      >
        <span className="monogram monogram--sm" aria-hidden="true">
          {initials}
        </span>
        <span className="ctl composerlite__field max-w-none text-dim">
          {single ? `What's new with ${cars[0].name}?` : "What's new with your build?"}
        </span>
      </button>

      {!single && picking && (
        <div className="composerlite__cars" role="group" aria-label="Choose the car to post about">
          {cars.map((car) => (
            <Link key={car.id} href={`/garage/${car.id}/update/new`} className="btn btn--ghost">
              {car.name}
            </Link>
          ))}
        </div>
      )}

      <p className="spec-note composerlite__hint">
        Text, photos or a YouTube clip — it all goes on the car&apos;s build page.
      </p>
    </div>
  );
}
