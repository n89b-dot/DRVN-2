/**
 * "What came off" (plan: two seller helpers). The build sheet lists only
 * aftermarket parts, so fitting first coilovers to a stock car left nothing
 * to mark removed, and the stock parts never got listed. When a mod goes on,
 * the editor offers the factory parts it usually replaces as tick boxes;
 * ticked ones become removed lines with origin `stock`, each with List it.
 *
 * `ModCategory` is too coarse for this (suspension covers coilovers and
 * sway bars alike), so a finer mod type is read from the product name by
 * keyword, with a short pick list when nothing matches. Static and AI-free:
 * AG-9 "update my build" calls the same functions. Overlaps B1, which will
 * eventually know what a product is; until then this is a guess the owner
 * confirms with a tick.
 */

import type { ModCategory } from "./parse";

export type StockPart = {
  /** What the removed line is called, e.g. "Stock springs". */
  label: string;
  /** How many came off, when it's a set. */
  qty?: number;
};

export type ModType = {
  key: string;
  /** For the pick list. */
  label: string;
  /** The build-sheet category the stock lines are filed under. */
  category: ModCategory;
  match: RegExp;
  /** A few items at most. */
  stock: readonly StockPart[];
};

/**
 * Most specific first: "coilover springs" is a coilover kit, "lowering
 * springs" is springs, "sway bar end links" is end links.
 */
export const MOD_TYPES: readonly ModType[] = [
  { key: "coilovers", label: "Coilovers", category: "suspension", match: /coil-?overs?|\bkw v[1-3]\b|\bbc racing\b/i, stock: [{ label: "Stock shocks", qty: 4 }, { label: "Stock springs", qty: 4 }, { label: "Stock top mounts", qty: 4 }] },
  { key: "air-ride", label: "Air suspension", category: "suspension", match: /air (ride|suspension|struts?|bags?)|airlift|air lift/i, stock: [{ label: "Stock shocks", qty: 4 }, { label: "Stock springs", qty: 4 }] },
  { key: "springs", label: "Springs", category: "suspension", match: /springs?\b/i, stock: [{ label: "Stock springs", qty: 4 }] },
  { key: "shocks", label: "Shocks or dampers", category: "suspension", match: /shocks?\b|dampers?\b|struts?\b/i, stock: [{ label: "Stock shocks", qty: 4 }] },
  { key: "end-links", label: "End links", category: "suspension", match: /end ?links?/i, stock: [{ label: "Stock end links", qty: 2 }] },
  { key: "sway-bars", label: "Anti-roll bars", category: "suspension", match: /sway ?bars?|anti-?roll|stabili[sz]er/i, stock: [{ label: "Stock anti-roll bar" }] },
  { key: "big-brake-kit", label: "Big brake kit", category: "brakes", match: /big brake|\bbbk\b|calipers?/i, stock: [{ label: "Stock calipers", qty: 2 }, { label: "Stock brake discs", qty: 2 }] },
  { key: "discs", label: "Brake discs", category: "brakes", match: /discs?\b|rotors?\b/i, stock: [{ label: "Stock brake discs", qty: 2 }] },
  { key: "downpipe", label: "Downpipe", category: "exhaust", match: /down ?pipe|\bdp\b/i, stock: [{ label: "Stock downpipe" }] },
  { key: "headers", label: "Headers or manifold", category: "exhaust", match: /headers?\b|manifold|\bexhaust mani/i, stock: [{ label: "Stock exhaust manifold" }] },
  { key: "exhaust", label: "Exhaust", category: "exhaust", match: /cat-?back|turbo-?back|axle-?back|exhaust|muffler|silencer/i, stock: [{ label: "Stock exhaust" }] },
  { key: "intake", label: "Intake", category: "intake", match: /intake|air ?filter|air ?box|\bcai\b/i, stock: [{ label: "Stock airbox" }] },
  { key: "intercooler", label: "Intercooler", category: "turbo", match: /intercooler|\bfmic\b/i, stock: [{ label: "Stock intercooler" }] },
  { key: "turbo", label: "Turbo", category: "turbo", match: /turbo(charger)?\b|supercharger/i, stock: [{ label: "Stock turbo" }] },
  { key: "wheels", label: "Wheels", category: "wheels", match: /(?<!steering )wheels?\b|rims?\b|\bte37\b|\brays\b|\bbbs\b|\benkei\b|\bvolk\b/i, stock: [{ label: "Stock wheels", qty: 4 }] },
  { key: "seats", label: "Seats", category: "interior", match: /seats?\b|bucket|recaro|bride\b|sparco/i, stock: [{ label: "Stock front seats", qty: 2 }] },
  { key: "headlights", label: "Headlights", category: "aero-exterior", match: /head ?lights?|headlamps?/i, stock: [{ label: "Stock headlights", qty: 2 }] },
  { key: "taillights", label: "Taillights", category: "aero-exterior", match: /tail ?lights?|tail ?lamps?|rear lights?/i, stock: [{ label: "Stock taillights", qty: 2 }] },
  { key: "clutch", label: "Clutch", category: "drivetrain", match: /clutch/i, stock: [{ label: "Stock clutch kit" }] },
  { key: "flywheel", label: "Flywheel", category: "drivetrain", match: /flywheel/i, stock: [{ label: "Stock flywheel" }] },
  { key: "shifter", label: "Short shifter", category: "drivetrain", match: /short ?shift|shifter/i, stock: [{ label: "Stock shifter" }] },
];

/**
 * Deliberately absent: steering wheels (the stock one carries the airbag,
 * which isn't something to list), ECU tunes (software; nothing comes off),
 * and aero that bolts on where nothing was.
 */

/** The finer type of a mod from its name, or null — then the editor asks. */
export function modTypeFor(name: string): ModType | null {
  const text = name.trim();
  if (!text) return null;
  return MOD_TYPES.find((t) => t.match.test(text)) ?? null;
}

export function modTypeByKey(key: string): ModType | null {
  return MOD_TYPES.find((t) => t.key === key) ?? null;
}

/** The pick list shown when the name matched nothing. Short on purpose. */
export const PICK_LIST: readonly ModType[] = [
  "coilovers", "springs", "exhaust", "intake", "wheels", "big-brake-kit", "seats",
].map((k) => modTypeByKey(k)!);

/** "Stock springs ×4" — the removed line's product text. */
export function stockLineLabel(part: StockPart): string {
  return part.qty && part.qty > 1 ? `${part.label} ×${part.qty}` : part.label;
}
