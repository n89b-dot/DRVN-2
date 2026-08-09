import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { Foot, Media } from "@/components/ui";
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

  const garage = cars ?? [];

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead">
        <span className="microlabel">Garage — your cars</span>
        <h1>
          The cars you&apos;re <span className="live-word">building.</span>
        </h1>
        <p className="sub">
          Each car gets its own build page. When you pull something off, list it straight from
          the build — buyers see exactly where it came from.
        </p>
        <div className="mt-4">
          <AddCarForm />
        </div>
      </Rv>

      <section className="deck">
        {garage.length > 0 ? (
          <Rv className="tile">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Your cars</span>
              <span className="chip">{garage.length}</span>
            </div>
            <div className="rowlist">
              {garage.map((car) => (
                <div key={car.id} className="order">
                  <span className="order__img">
                    <Media src={car.cover_image_url ?? undefined} alt={car.name} className="h-full w-full" />
                  </span>
                  <span>
                    <span className="order__name block">{car.name}</span>
                    <span className="order__meta block">
                      {[car.year, car.make, car.model].filter(Boolean).join(" ") || "No details yet"}
                    </span>
                  </span>
                  <span className="order__actions flex-col items-end gap-1.5">
                    {!car.is_public && <span className="chip">Private</span>}
                    <span className="flex gap-2">
                      {/* Manage is where every other action on this car lives
                          (photos, mods, updates, listing parts) — it's the one
                          action that matters most from this list. */}
                      <Link href={`/garage/${car.id}/edit`} className="btn btn--live">
                        Manage
                      </Link>
                      <Link href={`/cars/${car.slug}`} className="btn btn--ghost">
                        View build
                      </Link>
                    </span>
                    <span className="flex gap-3">
                      {/* The page's own copy promises listing parts straight off
                          a build; these stay reachable, just quieter than Manage. */}
                      <Link href={`/sell?car=${car.id}`} className="jumplink">
                        List a part
                      </Link>
                      <Link href={`/garage/${car.id}/update/new`} className="jumplink">
                        Post update
                      </Link>
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Rv>
        ) : (
          <Rv className="undrawn undrawn--hero">
            <span className="undrawn__mark" aria-hidden="true">
              +
            </span>
            <h3>Your car goes here</h3>
            <p>
              Add the car you&apos;re building. Photos, the full mod list, and every part you sell
              off it all live on one build page.
            </p>
            <AddCarForm />
          </Rv>
        )}
      </section>

      <Foot
        left="DRVN — listings you create here carry the car with them"
        right={<Link href="/home">← Home</Link>}
      />
    </div>
  );
}
