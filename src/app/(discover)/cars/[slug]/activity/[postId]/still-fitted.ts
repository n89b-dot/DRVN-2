import type { ActivityBlock } from "@/lib/activity-blocks";

type SheetMod = {
  id: string;
  status: string;
  brand: string | null;
  product: string | null;
  raw_text: string | null;
};

/**
 * A-3, the offer half: the parts this update says came off ("removed" or
 * "replaced", by mod id) that the build sheet still has fitted. These are the
 * ones the published post offers to mark off the car.
 */
export function partsStillFitted(blocks: ActivityBlock[], mods: SheetMod[]): { id: string; label: string }[] {
  const cameOff = new Set(
    blocks.flatMap((b) =>
      b.type === "mod" && b.modItemId && (b.action === "removed" || b.action === "replaced") ? [b.modItemId] : []
    )
  );
  return mods
    .filter((mod) => cameOff.has(mod.id) && mod.status === "installed")
    .map((mod) => ({
      id: mod.id,
      label: [mod.brand, mod.product].filter(Boolean).join(" ") || mod.raw_text || "That part",
    }));
}
