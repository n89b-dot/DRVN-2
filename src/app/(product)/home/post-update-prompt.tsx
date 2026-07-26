"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Avatar } from "@/components/ui";

type CarOption = { id: string; name: string };

/**
 * Composer-entry prompt at the top of the home feed (pattern: Skillshare's
 * feed composer). Clicking routes to the block editor — with one car it goes
 * straight there, with several it expands an inline car picker.
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
    <div className="mt-6 rounded-card border border-border bg-surface p-3">
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 text-left">
        <Avatar size="h-9 w-9" initials={initials} />
        <span className="flex h-10 flex-1 items-center rounded-pill bg-raised px-4 text-sm text-text-muted transition hover:text-text-secondary">
          What&apos;s new with your build?
        </span>
      </button>
      {picking && (
        <div className="mt-2 grid gap-1 border-t border-border pt-2">
          {cars.map((car) => (
            <Link
              key={car.id}
              href={`/garage/${car.id}/update/new`}
              className="rounded-xl px-3 py-2 text-sm text-text-secondary transition hover:bg-white/5 hover:text-text-primary"
            >
              Post about {car.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
