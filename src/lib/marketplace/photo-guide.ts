/**
 * Suggested photos for a listing, by marketplace subcategory (plan: "Photo
 * shot lists on the sell form"). A suggestion only — never proof of
 * condition and never required: publishing still needs just one photo
 * (M-5, W-2). Static and AI-free; "listing from photos" (AG-9) later reads
 * the same map to suggest the shots a seller hasn't taken.
 */

import { CATEGORIES } from "./taxonomy";

/** Shown until a category is known. */
export const GENERIC_SHOTS = [
  "The whole part",
  "Labels and part numbers",
  "Any damage, close up",
] as const;

type Split = { match: RegExp; shots: readonly string[] };

type Guide = {
  shots: readonly string[];
  /** Where one subcategory hides very different parts, the title picks a finer list. */
  splits?: readonly Split[];
};

export const PHOTO_GUIDE: Record<string, Guide> = {
  // Performance
  exhaust: { shots: ["The full system laid out", "Flanges and gaskets", "Welds and hangers", "Inside the tips", "Part number or stamp"] },
  intake: { shots: ["The whole kit", "Filter, both sides", "Couplers and clamps", "Mounting brackets", "Part number label"] },
  turbo: { shots: ["Compressor wheel, straight on", "Turbine side", "Flanges and oil feeds", "Housing tag or part number"] },
  intercoolers: { shots: ["The core, front on", "End tanks and welds", "Inlets and outlets", "Fins up close", "Part number label"] },
  tuning: { shots: ["The unit, front and back", "Connectors and pins", "Serial or part number label", "Cables included"] },
  fueling: { shots: ["Each part laid out", "Fittings and threads", "Part number or flow rating", "Connectors and wiring"] },

  // Engine
  internals: { shots: ["Each part laid out", "Bearing and contact surfaces", "Part numbers or stampings", "Any wear, close up"] },
  drivetrain: {
    shots: ["The whole part", "Wear surfaces", "Splines", "Part number label"],
    splits: [
      { match: /clutch|flywheel|pressure plate/i, shots: ["Clutch disc, both faces", "Pressure plate fingers", "Flywheel face", "Splines", "Part number label"] },
      { match: /diff|lsd|differential/i, shots: ["The diff, both sides", "Output flanges or splines", "Ring gear teeth", "Tag or part number"] },
      { match: /driveshaft|propshaft|axle|cv/i, shots: ["The full length", "Joints and boots", "Splines at each end", "Part number"] },
    ],
  },
  transmission: { shots: ["The gearbox, both sides", "Bellhousing face", "Input shaft splines", "Tag or casting number", "Any leaks or damage"] },
  "engine-mounts": { shots: ["Each mount", "Rubber or poly, close up", "Bolt holes and studs", "Part number"] },
  maintenance: { shots: ["The part in its box", "Part number label", "Seals or sealing faces", "Any damage, close up"] },

  // Exterior & Body
  aero: { shots: ["The whole piece", "Mounting points", "Edges and corners", "Finish up close", "Brackets and hardware"] },
  bumpers: { shots: ["Front on", "The back side", "Mounting tabs", "Sensor holes or cutouts", "Any cracks or scuffs"] },
  hoods: { shots: ["The top, whole", "The underside", "Hinges and latch points", "Finish up close", "Any damage"] },
  spoilers: { shots: ["The whole piece", "Uprights and mounts", "Edges and endplates", "Hardware included"] },
  "mirrors-trim": { shots: ["Each piece", "Clips and mounting tabs", "Finish up close", "Connectors, if powered"] },

  // Interior & Lighting
  seats: {
    shots: ["Front on", "Side bolsters", "The back", "Mounting points or rails", "Any wear or tears"],
    splits: [
      { match: /harness|belt/i, shots: ["The full harness laid out", "Buckle and adjusters", "Webbing up close", "Certification label and date"] },
    ],
  },
  steering: { shots: ["The face", "The back", "The hub or boss", "Grip up close", "Any wear"] },
  gauges: { shots: ["The face", "The back and connectors", "Sender or sensor", "Wiring included", "Part number label"] },
  headlights: { shots: ["The lens, front on", "The back and connectors", "Mounting tabs", "Lit up, if you can", "Any cracks or haze"] },
  "interior-trim": { shots: ["Each piece", "Clips and tabs", "Surface up close", "Any wear or damage"] },

  // Brakes & Suspension
  "big-brake-kits": { shots: ["The full kit laid out", "Calipers, both sides", "Disc faces", "Brackets and hardware", "Part numbers"] },
  "pads-rotors": { shots: ["Disc faces", "Disc edge, for thickness", "Pad friction surface", "Part number or box label"] },
  coilovers: {
    shots: ["The full set side by side", "Threads and collars", "Top mounts", "Part number label"],
    splits: [
      { match: /spring/i, shots: ["The full set side by side", "Spring ends", "Rate stamp or label", "Any coating damage"] },
    ],
  },
  "sway-bars": {
    shots: ["The whole part", "Bushings and mounts", "End links or ends", "Part number"],
    splits: [
      { match: /arm|link|toe|camber/i, shots: ["Each arm laid out", "Bushings or rod ends", "Threads and adjusters", "Part number"] },
    ],
  },
  "air-ride": { shots: ["Struts or bags, each", "Management unit", "Tank and compressor", "Lines and fittings", "Part number labels"] },

  // Wheels & Tires
  wheels: { shots: ["The full set side by side", "Face, straight on", "Barrel and inner lip", "Stamps: size, offset, PCD", "Any curb marks, close up"] },
  tires: { shots: ["The full set", "Tread depth with a gauge", "Sidewall size", "DOT date code", "Any damage"] },
  "spacers-hardware": { shots: ["The full set laid out", "Thickness stamp", "Studs or bolt holes", "Hub bore"] },
  tpms: { shots: ["Each sensor", "Part number or frequency label", "Valve stem"] },
};

/**
 * The suggested shots for a listing: the subcategory's list, sharpened by
 * the title where one subcategory hides very different parts, else the
 * generic list.
 */
export function shotListFor(subcategory: string | null | undefined, title?: string | null): readonly string[] {
  const guide = subcategory ? PHOTO_GUIDE[subcategory] : undefined;
  if (!guide) return GENERIC_SHOTS;
  const split = title ? guide.splits?.find((s) => s.match.test(title)) : undefined;
  return split?.shots ?? guide.shots;
}

/** Every taxonomy subcategory, for the coverage test. */
export const ALL_SUBCATEGORY_SLUGS = CATEGORIES.flatMap((c) => c.subcategories.map((s) => s.slug));
