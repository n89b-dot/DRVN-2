/**
 * DRVN marketplace taxonomy (PRD §8.3) — condensed ~6 top-level categories
 * (USP Motorsports as reference, deliberately not a wall of dense lists).
 */

export type Category = {
  slug: string;
  label: string;
  icon: CategoryIcon;
  subcategories: { slug: string; label: string }[];
};

export type CategoryIcon =
  | "turbo"
  | "engine"
  | "body"
  | "interior"
  | "brakes"
  | "wheel";

export const CATEGORIES: Category[] = [
  {
    slug: "performance",
    label: "Performance",
    icon: "turbo",
    subcategories: [
      { slug: "exhaust", label: "Exhaust & Downpipes" },
      { slug: "intake", label: "Intakes" },
      { slug: "turbo", label: "Turbos & Superchargers" },
      { slug: "intercoolers", label: "Intercoolers & Cooling" },
      { slug: "tuning", label: "Tuning & Electronics" },
      { slug: "fueling", label: "Fueling" },
    ],
  },
  {
    slug: "engine",
    label: "Engine",
    icon: "engine",
    subcategories: [
      { slug: "internals", label: "Internals & Rotating Assembly" },
      { slug: "drivetrain", label: "Drivetrain & Clutch" },
      { slug: "transmission", label: "Transmission" },
      { slug: "engine-mounts", label: "Mounts & Bushings" },
      { slug: "maintenance", label: "Maintenance & OEM Parts" },
    ],
  },
  {
    slug: "exterior-body",
    label: "Exterior & Body",
    icon: "body",
    subcategories: [
      { slug: "aero", label: "Aero & Splitters" },
      { slug: "bumpers", label: "Bumpers & Grilles" },
      { slug: "hoods", label: "Hoods & Fenders" },
      { slug: "spoilers", label: "Spoilers & Wings" },
      { slug: "mirrors-trim", label: "Mirrors & Trim" },
    ],
  },
  {
    slug: "interior-lighting",
    label: "Interior & Lighting",
    icon: "interior",
    subcategories: [
      { slug: "seats", label: "Seats & Harnesses" },
      { slug: "steering", label: "Steering Wheels" },
      { slug: "gauges", label: "Gauges & Displays" },
      { slug: "headlights", label: "Headlights & Taillights" },
      { slug: "interior-trim", label: "Interior Trim" },
    ],
  },
  {
    slug: "brakes-suspension",
    label: "Brakes & Suspension",
    icon: "brakes",
    subcategories: [
      { slug: "big-brake-kits", label: "Big Brake Kits" },
      { slug: "pads-rotors", label: "Pads & Rotors" },
      { slug: "coilovers", label: "Coilovers & Springs" },
      { slug: "sway-bars", label: "Sway Bars & Arms" },
      { slug: "air-ride", label: "Air Ride" },
    ],
  },
  {
    slug: "wheels-tires",
    label: "Wheels & Tires",
    icon: "wheel",
    subcategories: [
      { slug: "wheels", label: "Wheels" },
      { slug: "tires", label: "Tires" },
      { slug: "spacers-hardware", label: "Spacers & Hardware" },
      { slug: "tpms", label: "TPMS & Accessories" },
    ],
  },
];

export const CONDITIONS = [
  { value: "new", label: "New" },
  { value: "like_new", label: "Like new" },
  { value: "used", label: "Used" },
  { value: "for_parts", label: "For parts" },
] as const;

export function getCategory(slug: string) {
  return CATEGORIES.find((c) => c.slug === slug);
}

export function conditionLabel(value: string | null) {
  return CONDITIONS.find((c) => c.value === value)?.label ?? "";
}

export function formatPrice(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
