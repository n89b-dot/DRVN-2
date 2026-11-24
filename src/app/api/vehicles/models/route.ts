import { abuseIdentity, attributedNetworkIdentity } from "@/lib/abuse-identity";
import { RATE_LIMITS, allowAction } from "@/lib/rate-limit";
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

  // No sign-in, a service-role read and, for a make never asked for, a call
  // to the vehicle registry and a write: so it has a limit, keyed like
  // autocomplete.
  const visitor = attributedNetworkIdentity(request.headers);
  const rule = visitor ? RATE_LIMITS.vehicleModels : RATE_LIMITS.vehicleModelsUnattributed;
  if (!(await allowAction(rule, visitor ?? abuseIdentity(request.headers)))) {
    return Response.json({ models: [] }, { status: 429, headers: { "Retry-After": String(rule.windowSeconds), "Cache-Control": "no-store" } });
  }

  const models = await getVehicleModels(createAdminClient(), make);
  return Response.json(
    { models },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } }
  );
}
