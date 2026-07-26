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
        <span className="microlabel">The garage — owner&apos;s desk</span>
        <h1>
          Your side of the <span className="live-word">drawing.</span>
        </h1>
        <p className="sub">
          Every car is a sheet. Release parts straight off its build lines — a listing inherits
          the sheet&apos;s history the moment you file it.
        </p>
        <div className="mt-4">
          <AddCarForm />
        </div>
      </Rv>

      <section className="deck">
        {garage.length > 0 ? (
          <Rv className="tile">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Cars on the sheet</span>
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
                  <span className="order__actions">
                    {!car.is_public && <span className="chip">Private</span>}
                    <Link href={`/garage/${car.id}/edit`} className="btn btn--ghost">
                      Manage
                    </Link>
                    <Link href={`/cars/${car.slug}`} className="btn btn--ghost">
                      Public sheet
                    </Link>
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
              Add the car you&apos;re building. Photos, spec, and every part that comes off it hang
              from this one sheet.
            </p>
            <AddCarForm />
          </Rv>
        )}
      </section>

      <Foot
        left="DRVN / Livesheet — owner's desk · releases inherit the drawing"
        right={<Link href="/home">← Your sheet</Link>}
      />
    </div>
  );
}
