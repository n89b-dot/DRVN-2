import Link from "next/link";

import { Media, NarrowColumn, SectionLabel } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

import { AddCarForm } from "./add-car-form";

export const metadata = { title: "Garage - DRVN" };

export default async function GaragePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: cars } = await supabase
    .from("cars")
    .select("id, slug, name, make, model, year, cover_image_url, is_public")
    .eq("owner_id", user!.id)
    .order("created_at", { ascending: true });

  return (
    <NarrowColumn>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <SectionLabel>Garage</SectionLabel>
          <h1 className="mt-3 text-2xl font-bold text-text-primary">Your cars</h1>
        </div>
        <AddCarForm />
      </div>

      <div className="mt-8 flex flex-col gap-3">
        {(cars ?? []).map((car) => (
          <div
            key={car.id}
            className="flex flex-wrap items-center gap-4 rounded-card border border-border bg-surface p-4"
          >
            <Media
              src={car.cover_image_url ?? undefined}
              alt={car.name}
              className="h-16 w-24 shrink-0 rounded-tile"
            />
            <div className="min-w-[140px] flex-1">
              <p className="truncate font-semibold text-text-primary">{car.name}</p>
              <p className="mt-0.5 text-sm text-text-muted">
                {[car.year, car.make, car.model].filter(Boolean).join(" ") || "No details yet"}
                {!car.is_public && " · Private"}
              </p>
            </div>
            <div className="flex shrink-0 gap-2 text-sm">
              <Link
                href={`/garage/${car.id}/edit`}
                className="rounded-pill border border-border px-4 py-2 text-text-secondary transition hover:text-text-primary"
              >
                Manage
              </Link>
              <Link
                href={`/cars/${car.slug}`}
                className="rounded-pill border border-border px-4 py-2 text-text-secondary transition hover:text-text-primary"
              >
                View
              </Link>
            </div>
          </div>
        ))}

        {(cars ?? []).length === 0 && (
          <div className="rounded-card border border-dashed border-border p-10 text-center">
            <p className="text-sm text-text-secondary">No cars yet.</p>
            <p className="mt-1 text-sm text-text-muted">
              Add your first car to start documenting the build.
            </p>
          </div>
        )}
      </div>
    </NarrowColumn>
  );
}
