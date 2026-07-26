import Link from "next/link";
import { notFound, redirect } from "next/navigation";


import { createClient } from "@/lib/supabase/server";

import { CarDetailsForm } from "./car-details-form";
import { GalleryManager } from "./gallery-manager";
import { ModsEditor } from "./mods-editor";
import { ActivityComposer } from "./activity-composer";
import { DangerZone } from "./danger-zone";

export const metadata = { title: "Manage car - DRVN" };

export default async function CarEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: car } = await supabase
    .from("cars")
    .select("*")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();

  if (!car) notFound();

  const [{ data: images }, { data: mods }, { data: posts }] = await Promise.all([
    supabase.from("car_images").select("*").eq("car_id", id).order("position"),
    supabase.from("mod_items").select("*").eq("car_id", id).order("position"),
    supabase
      .from("activity_posts")
      .select("id, title, published_at")
      .eq("car_id", id)
      .order("published_at", { ascending: false }),
  ]);

  return (
    <div className="wrap">
      <header className="pagehead">
        <span className="microlabel">
          <Link href="/garage" className="hover:text-live">
            The garage
          </Link>{" "}
          / owner&apos;s desk ·{" "}
          <Link href={`/cars/${car.slug}`} className="hover:text-live">
            view public sheet →
          </Link>
        </span>
        <h1>Manage the {car.name}.</h1>
        <p className="sub">
          Your side of the drawing. Everything here writes straight onto the public sheet.
        </p>
      </header>

      <div className="deck">
        <CarDetailsForm car={car} />
        <GalleryManager carId={car.id} userId={user.id} images={images ?? []} />
        <ModsEditor carId={car.id} initialMods={mods ?? []} />
        <ActivityComposer carId={car.id} posts={posts ?? []} />
        <DangerZone carId={car.id} carName={car.name} />
      </div>
    </div>
  );
}
