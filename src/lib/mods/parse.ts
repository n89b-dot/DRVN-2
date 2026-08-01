/**
 * Heuristic paste parser for the build sheet (PRD §7.3 — the AI parse is the
 * later upgrade path).
 *
 * `mod_items.category` and `.confidence` have no DB enum/check constraint —
 * both are plain nullable columns (see supabase/migrations/0001_v3_schema.sql)
 * — so the category bucket below is our own small vocabulary, not a copy of
 * the marketplace listing taxonomy (`src/lib/marketplace/taxonomy.ts`), which
 * describes storefront categories rather than what's actually bolted to a car.
 */

/** The build-sheet groups a paste can declare via a header line ("Suspension:"). */
export const MOD_GROUPS = [
  "Performance",
  "Suspension",
  "Exterior",
  "Interior",
  "Wheels & Tires",
  "Other",
] as const;

export const MOD_CATEGORIES = [
  "suspension",
  "exhaust",
  "intake",
  "turbo",
  "wheels",
  "brakes",
  "ecu-tune",
  "aero-exterior",
  "interior",
  "drivetrain",
] as const;

export type ModCategory = (typeof MOD_CATEGORIES)[number];

export type ParsedModRow = {
  group_label: string;
  brand: string;
  product: string;
  part_number: string;
  category: ModCategory | null;
  confidence: number;
  raw_text: string;
};

/** Below this, the row is flagged for a human look rather than trusted as-is. */
export const LOW_CONFIDENCE_THRESHOLD = 0.55;

export function isLowConfidence(confidence: number): boolean {
  return confidence < LOW_CONFIDENCE_THRESHOLD;
}

/**
 * Curated automotive brands, including multi-word ones. Sorted longest-first
 * (by word count, then char length) so "Rays Engineering" matches before a
 * naive single-word check would grab just "Rays".
 */
const KNOWN_BRANDS = [
  "Rays Engineering",
  "Volk Racing",
  "Toyo Tires",
  "BC Racing",
  "Process West",
  "Grams Performance",
  "Cobb Tuning",
  "APR Performance",
  "Rocket Bunny",
  "Liberty Walk",
  "Air Lift Performance",
  "AWE Tuning",
  "Milltek Sport",
  "Injector Dynamics",
  "Precision Turbo",
  "IAG Performance",
  "Skunk2 Racing",
  "Verus Engineering",
  "K-Tuned",
  "Password JDM",
  "Buddy Club",
  "Spoon Sports",
  "Work Wheels",
  "Progress Group",
  "SPC Performance",
  "Godspeed Project",
  "ARK Performance",
  "Perrin Performance",
  "Hawk Performance",
  "Weds Sport",
  "GReddy",
  "Greddy",
  "HKS",
  "Cusco",
  "Whiteline",
  "Deatschwerks",
  "KW",
  "Bilstein",
  "Ohlins",
  "Öhlins",
  "H&R",
  "Eibach",
  "Tein",
  "Megan Racing",
  "Stance",
  "Borla",
  "Magnaflow",
  "Invidia",
  "Blitz",
  "Garrett",
  "Turbosmart",
  "BorgWarner",
  "Walbro",
  "AEM",
  "Haltech",
  "MoTeC",
  "Link ECU",
  "EcuTek",
  "Recaro",
  "Sparco",
  "Bride",
  "OMP",
  "Momo",
  "Brembo",
  "StopTech",
  "EBC",
  "Wilwood",
  "Enkei",
  "BBS",
  "Advan",
  "Konig",
  "Fifteen52",
  "Rotiform",
  "Vossen",
  "SSR",
  "Michelin",
  "Bridgestone",
  "Pirelli",
  "Nitto",
  "Falken",
  "Yokohama",
  "Continental",
  "Godspeed",
  "Mishimoto",
  "CSF",
  "PWR",
  "Perrin",
  "GrimmSpeed",
  "Unitronic",
  "Eventuri",
  "Seibon",
  "Voltex",
  "Varis",
  "Pandem",
  "Rywire",
  "Mugen",
  "TRD",
  "Nismo",
  "STI",
  "Ralliart",
  "034",
  "APR",
  "CTS",
].sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length || b.length - a.length);

const CATEGORY_KEYWORDS: [ModCategory, RegExp][] = [
  ["turbo", /\b(turbo(charger)?|supercharger|blower|wastegate|blow[- ]?off valve|\bbov\b)\b/i],
  [
    "exhaust",
    /\b(exhaust|downpipe|cat[- ]?back|catback|muffler|resonator|header|axle[- ]?back)\b/i,
  ],
  ["intake", /\b(intake|air filter|cold air|\bcai\b|throttle body)\b/i],
  [
    "suspension",
    /\b(coilover|coilovers|suspension|sway ?bar|strut|shock|damper|spring|springs|control arm)\b/i,
  ],
  ["brakes", /\b(brake|brakes|caliper|rotor|pad|pads|\bbbk\b|big brake kit)\b/i],
  [
    "wheels",
    // Includes a bare wheel-size token ("18x9.5") as a signal on its own,
    // since a pasted line often names the wheel without the word "wheel".
    /\b(wheel|wheels|rim|rims|tire|tires|tyre|tyres)\b|\b\d{2}(\.\d+)?x\d+(\.\d+)?\b/i,
  ],
  [
    "ecu-tune",
    /\b(ecu|tune|tuning|reflash|flash tune|piggyback|standalone|e-?tune|stage \d)\b/i,
  ],
  [
    "aero-exterior",
    /\b(spoiler|wing|splitter|diffuser|bumper|hood|fender|aero|body ?kit|widebody|wide ?body|vinyl|wrap|canard)\b/i,
  ],
  [
    "interior",
    /\b(seat|seats|harness|steering wheel|gauge|gauges|shift knob|shifter|interior trim)\b/i,
  ],
  [
    "drivetrain",
    /\b(clutch|flywheel|differential|\bdiff\b|driveshaft|axle|transmission|gearbox|limited slip|\blsd\b)\b/i,
  ],
];

/** Wheel sizes ("18x9.5"), year ranges ("2020-2023") — look like part numbers, aren't. */
const PART_NUMBER_EXCLUDE = [/^\d+(\.\d+)?x\d+(\.\d+)?$/i, /^(19|20)\d{2}-(19|20)\d{2}$/];

function looksLikePartNumber(token: string): boolean {
  const cleaned = token.replace(/[.,;:]+$/, "");
  if (cleaned.length < 4) return false;
  if (PART_NUMBER_EXCLUDE.some((re) => re.test(cleaned))) return false;

  const hasDigit = /\d/.test(cleaned);
  const hasLetter = /[A-Za-z]/.test(cleaned);
  const hasSeparator = /[-/]/.test(cleaned);

  if (!/^[A-Za-z0-9-/]+$/.test(cleaned)) return false;
  // Either an alphanumeric mix ("SF624", "18120AA160") or a digit run
  // stitched together with dashes/slashes ("034-145-0002").
  return (hasDigit && hasLetter) || (hasDigit && hasSeparator && cleaned.length >= 6);
}

function extractPartNumber(text: string): { partNumber: string; rest: string } {
  const tokens = text.split(/\s+/);
  const candidates = tokens
    .map((token, index) => ({ token, index }))
    .filter((c) => looksLikePartNumber(c.token));
  if (candidates.length === 0) return { partNumber: "", rest: text };

  // Dash/slash-separated tokens ("856801-5001S") read as part numbers more
  // reliably than a bare alnum mix ("GTX3076R" could just as easily be a
  // model name), so prefer them when both show up on the same line.
  const withSeparator = candidates.find((c) => /[-/]/.test(c.token));
  const chosen = withSeparator ?? candidates[0];

  const rest = [...tokens.slice(0, chosen.index), ...tokens.slice(chosen.index + 1)]
    .join(" ")
    .trim();
  return { partNumber: chosen.token.replace(/[.,;:]+$/, ""), rest };
}

function matchKnownBrand(line: string): { brand: string; rest: string } | null {
  for (const brand of KNOWN_BRANDS) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^${escaped}\\b`, "i");
    if (re.test(line)) {
      const rest = line.slice(brand.length).trim();
      return { brand, rest };
    }
  }
  return null;
}

/** Weighted heuristic — not a real probability, just a "how sure are we" signal. */
function scoreConfidence(opts: {
  brandSource: "known" | "fallback" | "none";
  categoryMatched: boolean;
  partNumberFound: boolean;
  hasProduct: boolean;
}): number {
  let score = 0;
  if (opts.brandSource === "known") score += 0.4;
  else if (opts.brandSource === "fallback") score += 0.15;

  if (opts.categoryMatched) score += 0.3;
  if (opts.partNumberFound) score += 0.15;
  if (opts.hasProduct) score += 0.15;

  return Math.round(Math.min(score, 1) * 100) / 100;
}

/**
 * Parses one non-header, non-empty line of a pasted mod list into brand /
 * product / part number / category / confidence.
 */
export function parseModLine(line: string): Omit<ParsedModRow, "group_label"> {
  const known = matchKnownBrand(line);
  const words = line.split(/\s+/);

  let brand = "";
  let remainder = line;
  let brandSource: "known" | "fallback" | "none" = "none";

  if (known) {
    brand = known.brand;
    remainder = known.rest;
    brandSource = "known";
  } else if (words.length > 1) {
    // Fallback for brands we don't recognize: assume the first word is the
    // brand, same as a plain "Brand Product" paste would read.
    brand = words[0];
    remainder = words.slice(1).join(" ");
    brandSource = "fallback";
  }

  const { partNumber, rest } = extractPartNumber(remainder);
  const product = (rest || remainder).trim() || (brand ? "" : line);

  let category: ModCategory | null = null;
  for (const [cat, re] of CATEGORY_KEYWORDS) {
    if (re.test(line)) {
      category = cat;
      break;
    }
  }

  const confidence = scoreConfidence({
    brandSource,
    categoryMatched: category !== null,
    partNumberFound: partNumber.length > 0,
    hasProduct: product.trim().length > 0,
  });

  return {
    brand,
    product,
    part_number: partNumber,
    category,
    confidence,
    raw_text: line,
  };
}

/**
 * Splits a pasted build list into rows, tracking the current group from any
 * header lines ("Performance:", "EXTERIOR") along the way.
 */
export function parsePasteText(text: string): ParsedModRow[] {
  const rows: ParsedModRow[] = [];
  let currentGroup: string = MOD_GROUPS[MOD_GROUPS.length - 1]; // "Other"

  for (const rawLine of text.split("\n")) {
    // Strip list bullets ("-", "•", "1.", "2)") but not numeric brands like "034".
    const line = rawLine.replace(/^\s*(?:[-•*]+|\d{1,2}[.)])\s+/, "").trim();
    if (!line) continue;

    const headerCandidate = line.replace(/[:\-–]+$/, "").trim();
    const matchedGroup = MOD_GROUPS.find(
      (g) => g.toLowerCase() === headerCandidate.toLowerCase()
    );
    if (matchedGroup && headerCandidate.length === line.replace(/[:\-–]+$/, "").trim().length && line.length < 30) {
      currentGroup = matchedGroup;
      continue;
    }

    rows.push({ group_label: currentGroup, ...parseModLine(line) });
  }

  return rows;
}
