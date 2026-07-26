import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

import { SellForm } from "./sell-form";

export const metadata = { title: "Sell a part - DRVN" };

export default async function SellPage({
  searchParams,
}: {
  // `car` and `mod` arrive from "release a part" on a car sheet or the garage.
  searchParams: Promise<{ car?: string; mod?: string }>;
}) {
  const { car: carParam, mod: modParam } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: cars, error } = await supabase
    .from("cars")
    .select("id, name")
    .eq("owner_id", user.id)
    .order("created_at");

  if (error) console.error("[sell] failed to load cars", error);

  // Only honour the pre-fill if this really is the seller's own car.
  const sourceCar = carParam ? cars?.find((c) => c.id === carParam) : undefined;

  let prefill:
    | {
        carId?: string;
        title?: string;
        category?: string;
        modItemId?: string;
        partNumber?: string;
      }
    | undefined;
  if (sourceCar) {
    prefill = { carId: sourceCar.id };

    if (modParam) {
      const { data: mod } = await supabase
        .from("mod_items")
        .select("id, brand, product, raw_text, category, part_number, car_id")
        .eq("id", modParam)
        .eq("car_id", sourceCar.id)
        .maybeSingle();

      if (mod) {
        const title = [mod.brand, mod.product].filter(Boolean).join(" ") || mod.raw_text || "";
        prefill = {
          carId: sourceCar.id,
          title: title.slice(0, 140),
          category: mod.category ?? undefined,
          modItemId: mod.id,
          // The build line already knows the part number — carry it across so
          // the seller isn't retyping what the sheet recorded.
          partNumber: mod.part_number ?? undefined,
        };
      }
    }
  }

  return (
    <div className="mx-auto w-full max-w-[860px] px-5 pb-10">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          {prefill?.modItemId
            ? `Releasing a part off ${sourceCar?.name}`
            : "Part sheet — draft · not yet public"}
        </span>
        <h1>
          Draw a new <span className="live-word">line.</span>
        </h1>
        <p className="sub">
          Fill the sheet and the listing draws itself. Save a draft to come back to it, or publish
          straight to the market.
        </p>
      </Rv>

      <SellForm cars={cars ?? []} userId={user.id} prefill={prefill} />

      <div className="mt-8">
        <Link href="/listings" className="jumplink inline-flex">
          Manage all your listings
        </Link>
      </div>

      <Foot
        left="DRVN / Livesheet — drafts stay private until you publish"
        right={<Link href="/marketplace">← Back to the market</Link>}
      />
    </div>
  );
}
