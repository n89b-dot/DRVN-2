import { getVehicleModels } from "@/lib/vehicles/vpic";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Models for one make, for the fitment picker's datalist — cache-first via
 * vehicle_models (0025), one vPIC round-trip per make ever. Public reference
 * data, so no auth gate; the response is cacheable per make.
 */
export async function GET(request: Request) {
  const make = new URL(request.url).searchParams.get("make")?.trim() ?? "";
  if (!make || make.length > 60) {
    return Response.json({ models: [] }, { status: 400 });
  }

  const models = await getVehicleModels(createAdminClient(), make);
  return Response.json(
    { models },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } }
  );
}
