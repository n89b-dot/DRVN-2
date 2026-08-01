"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type CarOption = { id: string; name: string };

/**
 * Composer-entry prompt on Home. Clicking routes to the block
 * editor — with one car it goes straight there, with several it expands an
 * inline car picker as ruled rows.
 */
export function PostUpdatePrompt({ cars, initials }: { cars: CarOption[]; initials: string }) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);

  if (cars.length === 0) return null;

  function onClick() {
    if (cars.length === 1) {
      router.push(`/garage/${cars[0].id}/update/new`);
    } else {
      setPicking((p) => !p);
    }
  }

  return (
    <div className="mb-4">
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 text-left">
        <span className="monogram monogram--sm" aria-hidden="true">
          {initials}
        </span>
        <span className="ctl max-w-none text-dim">What&apos;s new with your build?</span>
      </button>
      {picking && (
        <div className="rowlist mt-2">
          {cars.map((car) => (
            <Link key={car.id} href={`/garage/${car.id}/update/new`} className="order">
              <span>
                <span className="order__name block">Post about {car.name}</span>
                <span className="order__meta block">opens the update editor →</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
