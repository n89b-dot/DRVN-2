"use server";

import { revalidatePath } from "@/lib/revalidate";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type ModActionState = { error?: string; ok?: string };

/**
 * A-3's other half: an update that says a part came off offers to make that
 * true on the sheet.
 *
 * It is an offer, not a consequence. Publishing an update is a story-telling
 * act and the mod sheet is a record; letting the first rewrite the second
 * automatically would mean a mistyped block quietly strips a part off a
 * build — and the part may genuinely still be fitted while its owner writes
 * about taking it off next weekend.
 *
 * It lives in `features/activity` rather than beside the garage's own actions
 * because the surface that offers it is the public post page: a route may not
 * reach into another route's actions, and this is the shared middle.
 */
export async function markModRemoved(
  _previous: ModActionState,
  formData: FormData
): Promise<ModActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const modItemId = String(formData.get("mod_item_id") ?? "");
  const carId = String(formData.get("car_id") ?? "");
  if (!modItemId || !carId) return { error: "That part is missing." };

  const { data: car } = await supabase
    .from("cars")
    .select("id, slug, owner_id")
    .eq("id", carId)
    .maybeSingle();
  if (!car || car.owner_id !== user.id) return { error: "That car isn't in your garage." };

  // Already off the car is the desired state, not an error — the owner may
  // have taken the same offer twice, or edited the sheet in between. The
  // status filter is also what keeps `removed_at` honest: a part that came
  // off in March doesn't get today's date because the page was reloaded.
  const { error } = await supabase
    .from("mod_items")
    .update({ status: "removed", removed_at: new Date().toISOString() })
    .eq("id", modItemId)
    .eq("car_id", carId)
    .eq("status", "installed");
  if (error) return { error: error.message };

  revalidatePath(`/garage/${carId}/edit`);
  revalidatePath(`/cars/${car.slug}`);
  return { ok: "Marked as off the car." };
}
