import { getCatalogModels } from "@/lib/vehicles/catalog";

/**
 * Ranked model list for one catalog make — popular first, aliases included so
 * the picker can match "Rabbit" to Golf. Public reference data, cacheable.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("make") ?? "";
  const makeId = Number.parseInt(raw, 10);
  if (!Number.isFinite(makeId) || makeId <= 0) {
    return Response.json({ models: [] }, { status: 400 });
  }

  const models = await getCatalogModels(makeId);
  return Response.json(
    {
      models: models.map((model) => ({
        id: model.id,
        name: model.name,
        aliases: model.aliases ?? undefined,
      })),
    },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
  );
}
