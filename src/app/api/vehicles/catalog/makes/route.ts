import { getCatalogMakes } from "@/lib/vehicles/catalog";

/**
 * Ranked make list for the Add Car picker — popular makes first (VehiclesDB
 * global deciles), alphabetical inside a band. Public reference data, heavily
 * cacheable; the catalog changes only when an import runs.
 */
export async function GET() {
  const makes = await getCatalogMakes();
  return Response.json(
    { makes: makes.map((make) => ({ id: make.id, name: make.name })) },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
  );
}
