import type { ActivityBlock } from "@/lib/activity-blocks";

export type SeedMod = {
  id: string;
  brand: string | null;
  product: string | null;
  raw_text: string | null;
  status: string | null;
};

/** The mod's name as the build sheet writes it — and as its "what changed"
 *  suggestion sends it here (mods-editor's `label`). */
export function modBaseLabel(mod: Pick<SeedMod, "brand" | "product" | "raw_text">): string {
  return [mod.brand, mod.product].filter(Boolean).join(" ").trim() || (mod.raw_text ?? "").trim() || "Build entry";
}

/** How the composer's part picker names a mod: a part that came off stays
 *  pickable and says so — an update is very often about the part that left. */
export function modPickerLabel(mod: SeedMod): string {
  return modBaseLabel(mod) + (mod.status === "removed" ? " — off the car" : "");
}

function parseLabels(raw?: string): string[] {
  return (raw ?? "")
    .split("|")
    .map((label) => label.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 3);
}

/**
 * "Create an update from these changes" (§W): the sheet's added and removed
 * labels become mod blocks. Each carries the mod's id (A-3) — matched among
 * the installed mods for an addition and the removed ones for a removal — so
 * a removed block gets its "Sell this part" link and, once published, the
 * offer to mark the part off the car. A label the sheet no longer has stays
 * a plain block.
 */
export function seedChangeBlocks(seeds: { added?: string; removed?: string }, mods: SeedMod[]): ActivityBlock[] {
  const idFor = (status: "installed" | "removed") => {
    const byLabel = new Map<string, string>();
    for (const mod of mods) {
      const label = modBaseLabel(mod);
      if ((mod.status ?? "installed") === status && !byLabel.has(label)) byLabel.set(label, mod.id);
    }
    return byLabel;
  };
  const installed = idFor("installed");
  const removed = idFor("removed");
  return [
    ...parseLabels(seeds.added).map(
      (label): ActivityBlock => ({ type: "mod", action: "installed", modItemId: installed.get(label) ?? null, label })
    ),
    ...parseLabels(seeds.removed).map(
      (label): ActivityBlock => ({ type: "mod", action: "removed", modItemId: removed.get(label) ?? null, label })
    ),
  ];
}
