import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot } from "@/components/ui";
import { mapModCategoryToListing } from "@/lib/mods/category-map";
import { sellerCanPublish } from "@/lib/payments/connect";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getVehicleMakes } from "@/lib/vehicles/vpic";

import { SellForm } from "./sell-form";
import { reportError } from "@/lib/monitoring";

export const metadata = { title: "Sell a part - DRVN" };

export default async function SellPage({
  searchParams,
}: {
  // `car` and `mod` arrive from "list a part" on a build page or the garage.
  searchParams: Promise<{ car?: string; mod?: string }>;
}) {
  const { car: carParam, mod: modParam } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: cars, error }, makes, canPublish] = await Promise.all([
    supabase.from("cars").select("id, name").eq("owner_id", user.id).order("created_at"),
    getVehicleMakes(createAdminClient()),
    // Fail open for the UI gate only: a payments misconfig must not 500 the
    // sell page (resolvePaymentsMode throws by design). The server action
    // re-checks on publish either way.
    sellerCanPublish(user.id).catch(() => true),
  ]);

  if (error) reportError("[sell] failed to load cars", error);

  // Only honour the pre-fill if this really is the seller's own car.
  const sourceCar = carParam ? cars?.find((c) => c.id === carParam) : undefined;

  let prefill:
    | {
        carId?: string;
        title?: string;
        category?: string;
        subcategory?: string;
        modItemId?: string;
        partNumber?: string;
        modConfidence?: number | null;
      }
    | undefined;
  if (sourceCar) {
    prefill = { carId: sourceCar.id };

    if (modParam) {
      const { data: mod } = await supabase
        .from("mod_items")
        .select("id, brand, product, raw_text, category, confidence, part_number, car_id")
        .eq("id", modParam)
        .eq("car_id", sourceCar.id)
        .maybeSingle();

      if (mod) {
        const title = [mod.brand, mod.product].filter(Boolean).join(" ") || mod.raw_text || "";
        // The build sheet's own category vocabulary isn't the storefront
        // taxonomy (see src/lib/mods/category-map.ts) — translate it rather
        // than handing the raw mod category to a <select> that doesn't have
        // it as an option.
        const { category, subcategory } = mapModCategoryToListing(mod.category);
        prefill = {
          carId: sourceCar.id,
          title: title.slice(0, 140),
          category,
          subcategory,
          modItemId: mod.id,
          // The mod entry already knows the part number — carry it across so
          // the seller isn't retyping what the build already recorded.
          partNumber: mod.part_number ?? undefined,
          // Listings have no confidence column (see database.types.ts) — this
          // rides along only to tell the seller the category is a guess, it
          // is never persisted.
          modConfidence: mod.confidence,
        };
      }
    }
  }

  return (
    <div className="mx-auto w-full max-w-[860px] px-5 pb-10">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          {prefill?.modItemId
            ? `Listing a part off your ${sourceCar?.name}`
            : "New listing — draft, not public yet"}
        </span>
        <h1>
          List a <span className="live-word">part.</span>
        </h1>
        <p className="sub">
          Takes a few minutes. Link it to a car in your garage so buyers can see the build it
          came off — it&apos;s the difference between a listing and a shrug.
        </p>
      </Rv>

      <SellForm
        cars={cars ?? []}
        makes={makes.map((m) => m.name)}
        userId={user.id}
        prefill={prefill}
        canPublish={canPublish}
      />

      <div className="mt-8">
        <Link href="/listings" className="jumplink inline-flex">
          Manage all your listings
        </Link>
      </div>

      <Foot
        left="DRVN — drafts stay private until you publish"
        right={<Link href="/marketplace">← Back to the marketplace</Link>}
      />
    </div>
  );
}
