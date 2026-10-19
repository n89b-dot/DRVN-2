import Link from "next/link";
import { notFound, redirect } from "next/navigation";


import { getPageClient, getViewer } from "@/lib/supabase/page-context";
import { requiredRead } from "@/lib/supabase/required-read";

import { CarDetailsForm } from "./car-details-form";
import { GalleryManager } from "./gallery-manager";
import { ShowcaseEditor } from "./showcase-editor";
import { ModsEditor } from "./mods-editor";
import { ActivityComposer } from "./activity-composer";
import { DangerZone } from "./danger-zone";
import { postHeadline } from "@/lib/activity/headline";
import { CAR_COLUMNS } from "@/lib/cars/columns";
import type { BuildDraft } from "@/features/agent/build-change";
import type { TurnCard } from "@/lib/ai/run";

export const metadata = { title: "Manage car - DRVN" };

export default async function CarEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `change`: an agent's "Update my build" draft to open filled in (A3c Edit). */
  searchParams: Promise<{ change?: string }>;
}) {
  const { id } = await params;
  const { change } = await searchParams;
  const supabase = await getPageClient();
  const user = await getViewer();
  if (!user) redirect("/login");

  // RR-11: a failed read is a failed page, not "no such car" and not an
  // empty editor — the mod editor's save replaces the whole list.
  const carRow = requiredRead(
    await supabase.from("cars").select(CAR_COLUMNS).eq("id", id).eq("owner_id", user.id).maybeSingle(),
    "this car"
  );

  if (!carRow) notFound();
  // The VIN is the owner's alone (20261004160000): read through the one
  // function that returns it only to them.
  const { data: vin, error: vinError } = await supabase.rpc("my_car_vin", { p_car: id });
  if (vinError) throw new Error("Couldn't load this car's VIN.");
  const car = { ...carRow, vin: vin ?? null };

  const [imagesResult, modsResult, postsResult, hotspotsResult, profileResult] =
    await Promise.all([
      supabase.from("car_images").select("*").eq("car_id", id).order("position"),
      supabase
        .from("mod_items")
        .select("*, linked_listing:listings!mod_items_linked_listing_id_fkey(status)")
        .eq("car_id", id)
        .order("position"),
      supabase
        .from("activity_posts")
        .select("id, title, intro, body, published_at")
        .eq("car_id", id)
        .is("draft_archived_at", null)
        .order("published_at", { ascending: false }),
      supabase.from("car_hotspots").select("*").eq("car_id", id).order("created_at"),
      supabase.from("profiles").select("main_car_id").eq("id", user.id).maybeSingle(),
    ]);
  // The draft is read from the member's own chat, so only their agent's
  // cards open here, and only for this car.
  let draft: BuildDraft | null = null;
  if (change && /^[0-9a-f-]{36}$/i.test(change)) {
    const { data: messages } = await supabase
      .from("agent_messages")
      .select("cards")
      .eq("owner_id", user.id)
      .contains("cards", JSON.stringify([{ id: change }]))
      .limit(1);
    const card = ((messages?.[0]?.cards ?? []) as TurnCard[]).find((c): c is BuildDraft => c.kind === "build_change" && c.id === change);
    draft = card && card.car === id ? card : null;
  }
  const images = requiredRead(imagesResult, "this car's photos");
  const mods = requiredRead(modsResult, "this car's mod list");
  const hotspots = requiredRead(hotspotsResult, "this car's showcase");
  const profile = requiredRead(profileResult, "your profile");
  // An error here was read as "no posts", so a car with three published
  // updates said "Nothing posted yet". Where the archive column isn't there
  // (a database behind its migrations) nothing can have been archived, so
  // the unfiltered list is the right one.
  let posts = postsResult.data;
  if (postsResult.error) {
    posts = requiredRead(
      await supabase
        .from("activity_posts")
        .select("id, title, intro, body, published_at")
        .eq("car_id", id)
        .order("published_at", { ascending: false }),
      "this car's updates"
    );
  }

  return (
    <div className="wrap">
      <header className="pagehead">
        <span className="microlabel">
          <Link href="/garage" className="hover:text-live">
            The garage
          </Link>{" "}
          / manage ·{" "}
          <Link href={`/cars/${car.slug}`} className="hover:text-live">
            view build page →
          </Link>
        </span>
        <h1>Manage {car.name}</h1>
        <p className="sub">
          Everything here shows on the car&apos;s public build page — and on any part you list off
          it.
        </p>
      </header>

      <div className="deck">
        <CarDetailsForm car={car} isMain={profile?.main_car_id === car.id} />
        <GalleryManager
          carId={car.id}
          userId={user.id}
          images={images ?? []}
          coverImageUrl={car.cover_image_url}
          coverFocal={{ x: car.cover_focal_x, y: car.cover_focal_y }}
        />
        <ModsEditor carId={car.id} carMake={car.make} initialMods={mods ?? []} draft={draft} />
        <ShowcaseEditor
          carId={car.id}
          images={images ?? []}
          mods={mods ?? []}
          initial={hotspots ?? []}
        />
        <ActivityComposer
          carId={car.id}
          posts={(posts ?? []).map((p) => ({ ...p, title: postHeadline(p) }))}
        />
        <DangerZone carId={car.id} carName={car.name} />
      </div>
    </div>
  );
}
