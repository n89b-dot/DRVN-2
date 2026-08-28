/**
 * The importer's DRVN-owned data contracts (0047).
 *
 * Every source adapter converges into `NormalizedImportSource` BEFORE the AI
 * runs, and the AI's answer is re-validated into `ListingImportExtraction`
 * before anything is stored — no crawler library's representation and no raw
 * model output is ever the canonical shape. Both types round-trip through
 * `listing_imports.normalized_source` / `.extracted` jsonb, so the parsers
 * here are the runtime schema validation for those columns too.
 */

import type { Json } from "@/lib/database.types";

// ---------------------------------------------------------------------------
// Normalized source — what ingestion hands to extraction
// ---------------------------------------------------------------------------

export type ImportImageCandidate = {
  url: string;
  alt?: string;
  /** Declared dimensions when the source markup stated them — a filter hint,
   *  never trusted; real validation happens on the downloaded bytes. */
  width?: number;
  height?: number;
};

export type NormalizedImportSource = {
  /** Adapter that produced this ("facebook", "xenforo", "paste", …). */
  sourceType: string;
  sourceUrl?: string;
  canonicalUrl?: string;
  sourceDomain?: string;
  title?: string;
  /** The post/listing text. The one required field — everything else is bonus. */
  text: string;
  /** Deterministically-parsed facts (JSON-LD, OpenGraph, engine markup).
   *  These outrank anything the AI infers from prose. */
  structuredFacts?: {
    priceText?: string;
    currency?: string;
    location?: string;
    conditionText?: string;
    partNumber?: string;
    availability?: string;
  };
  images: ImportImageCandidate[];
  /** How the page was obtained — analytics + debugging, never product logic. */
  fetchMethod?: "http" | "render" | "paste";
};

const MAX_TEXT = 20_000;
const MAX_IMAGES = 24;

function str(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

/** Parses + bounds a stored/incoming normalized source. Null = unusable. */
export function parseNormalizedSource(raw: unknown): NormalizedImportSource | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const text = str(o.text, MAX_TEXT);
  const sourceType = str(o.sourceType, 40);
  if (!text || !sourceType) return null;

  const images: ImportImageCandidate[] = [];
  if (Array.isArray(o.images)) {
    for (const img of o.images.slice(0, MAX_IMAGES)) {
      if (!img || typeof img !== "object") continue;
      const url = str((img as Record<string, unknown>).url, 2048);
      if (!url || !/^https?:\/\//i.test(url)) continue;
      const width = (img as Record<string, unknown>).width;
      const height = (img as Record<string, unknown>).height;
      images.push({
        url,
        alt: str((img as Record<string, unknown>).alt, 200),
        width: typeof width === "number" && width > 0 ? Math.floor(width) : undefined,
        height: typeof height === "number" && height > 0 ? Math.floor(height) : undefined,
      });
    }
  }

  const factsRaw = o.structuredFacts;
  const facts =
    factsRaw && typeof factsRaw === "object"
      ? {
          priceText: str((factsRaw as Record<string, unknown>).priceText, 60),
          currency: str((factsRaw as Record<string, unknown>).currency, 8),
          location: str((factsRaw as Record<string, unknown>).location, 120),
          conditionText: str((factsRaw as Record<string, unknown>).conditionText, 120),
          partNumber: str((factsRaw as Record<string, unknown>).partNumber, 120),
          availability: str((factsRaw as Record<string, unknown>).availability, 60),
        }
      : undefined;

  const fetchMethod = str(o.fetchMethod, 10);
  return {
    sourceType,
    sourceUrl: str(o.sourceUrl, 2048),
    canonicalUrl: str(o.canonicalUrl, 2048),
    sourceDomain: str(o.sourceDomain, 255),
    title: str(o.title, 300),
    text,
    structuredFacts: facts,
    images,
    fetchMethod:
      fetchMethod === "http" || fetchMethod === "render" || fetchMethod === "paste"
        ? fetchMethod
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Extraction — what review/prefill consumes
// ---------------------------------------------------------------------------

/** Fields the review UI can attach a specific "check this" note to. */
export const REVIEW_FIELDS = [
  "title",
  "category",
  "condition",
  "price",
  "shipping",
  "offers",
  "part_number",
  "location",
  "fitment",
  "description",
  "photos",
] as const;
export type ImportReviewField = (typeof REVIEW_FIELDS)[number];

/** A specific reason the seller must look at one field — never a score. */
export type ImportReviewIssue = { field: ImportReviewField; message: string };

export type CandidateFitment = {
  make: string;
  model: string;
  year_start: number | null;
  year_end: number | null;
  /** The wording that produced this candidate ("mk7 R", "8V S3"). */
  sourceText: string;
};

export type ExtractedItem = {
  label: string;
  priceText?: string;
};

export type ImportCondition = "new" | "like_new" | "used" | "for_parts";

export type ListingImportExtraction = {
  isSalePost: boolean;
  multipleItems: boolean;
  /** Present when multipleItems — the seller picks one. */
  items?: ExtractedItem[];

  title?: string;
  description?: string;
  category?: string;
  subcategory?: string;
  condition?: ImportCondition;

  priceCents?: number;
  shippingCents?: number;
  shippingIncluded?: boolean;
  acceptsOffers?: boolean;
  allowsCollection?: boolean;

  partNumber?: string;
  location?: string;
  compatibilityNotes?: string;

  rawFitmentMentions: string[];
  candidateFitments?: CandidateFitment[];
  /** Candidates the DRVN vehicle catalog confirmed (fitment.ts) — what the
   *  picker is seeded with. Years only ever come from the post's own words. */
  resolvedFitments?: { make: string; model: string; year_start: number | null; year_end: number | null }[];

  needsReview: ImportReviewIssue[];
  /** Internal provenance per field ("json_ld", "explicit_text",
   *  "ai_normalized") — debugging/analytics only, never shown as a score. */
  fieldSources?: Record<string, string>;
};

/** A photo already re-hosted into the seller's own DRVN storage. */
export type ImportedImage = {
  /** Where the bytes came from (dedupe key across retries). */
  sourceUrl: string;
  /** The DRVN public URL — passes isOwnedStorageUrl for this seller. */
  url: string;
  path: string;
};

const CONDITIONS: ImportCondition[] = ["new", "like_new", "used", "for_parts"];

function cents(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded < 0 || rounded > 100_000_000) return undefined;
  return rounded;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Parses a stored or freshly-produced extraction into the typed contract.
 * Purely structural — the semantic checks (taxonomy resolution, non-invention
 * verification) live in extract/validate.ts and run before storage.
 */
export function parseExtraction(raw: unknown): ListingImportExtraction | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.isSalePost !== "boolean") return null;

  const mentions = Array.isArray(o.rawFitmentMentions)
    ? o.rawFitmentMentions
        .filter((m): m is string => typeof m === "string" && Boolean(m.trim()))
        .map((m) => m.trim().slice(0, 80))
        .slice(0, 12)
    : [];

  const items = Array.isArray(o.items)
    ? o.items
        .map((item): ExtractedItem | null => {
          if (!item || typeof item !== "object") return null;
          const label = str((item as Record<string, unknown>).label, 140);
          if (!label) return null;
          return { label, priceText: str((item as Record<string, unknown>).priceText, 40) };
        })
        .filter((i): i is ExtractedItem => i !== null)
        .slice(0, 40)
    : undefined;

  const candidates = Array.isArray(o.candidateFitments)
    ? o.candidateFitments
        .map((c): CandidateFitment | null => {
          if (!c || typeof c !== "object") return null;
          const rec = c as Record<string, unknown>;
          const make = str(rec.make, 60);
          const model = str(rec.model, 80);
          if (!make || !model) return null;
          const year = (v: unknown): number | null =>
            typeof v === "number" && Number.isInteger(v) && v >= 1930 && v <= 2035 ? v : null;
          return {
            make,
            model,
            year_start: year(rec.year_start),
            year_end: year(rec.year_end),
            sourceText: str(rec.sourceText, 80) ?? `${make} ${model}`,
          };
        })
        .filter((c): c is CandidateFitment => c !== null)
        .slice(0, 10)
    : undefined;

  const resolvedFitments = Array.isArray(o.resolvedFitments)
    ? o.resolvedFitments
        .map((r): { make: string; model: string; year_start: number | null; year_end: number | null } | null => {
          if (!r || typeof r !== "object") return null;
          const rec = r as Record<string, unknown>;
          const make = str(rec.make, 60);
          const model = str(rec.model, 80);
          if (!make || !model) return null;
          const year = (v: unknown): number | null =>
            typeof v === "number" && Number.isInteger(v) && v >= 1930 && v <= 2035 ? v : null;
          return { make, model, year_start: year(rec.year_start), year_end: year(rec.year_end) };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .slice(0, 10)
    : undefined;

  const needsReview: ImportReviewIssue[] = [];
  if (Array.isArray(o.needsReview)) {
    for (const issue of o.needsReview.slice(0, 20)) {
      if (!issue || typeof issue !== "object") continue;
      const field = (issue as Record<string, unknown>).field;
      const message = str((issue as Record<string, unknown>).message, 200);
      if (
        typeof field === "string" &&
        (REVIEW_FIELDS as readonly string[]).includes(field) &&
        message
      ) {
        needsReview.push({ field: field as ImportReviewField, message });
      }
    }
  }

  const conditionRaw = o.condition;
  const fieldSources: Record<string, string> = {};
  if (o.fieldSources && typeof o.fieldSources === "object") {
    for (const [key, value] of Object.entries(o.fieldSources as Record<string, unknown>)) {
      if (typeof value === "string") fieldSources[key.slice(0, 40)] = value.slice(0, 40);
    }
  }

  return {
    isSalePost: o.isSalePost,
    multipleItems: o.multipleItems === true,
    items,
    title: str(o.title, 140),
    description: str(o.description, 8000),
    category: str(o.category, 60),
    subcategory: str(o.subcategory, 60),
    condition: CONDITIONS.includes(conditionRaw as ImportCondition)
      ? (conditionRaw as ImportCondition)
      : undefined,
    priceCents: cents(o.priceCents),
    shippingCents: cents(o.shippingCents),
    shippingIncluded: bool(o.shippingIncluded),
    acceptsOffers: bool(o.acceptsOffers),
    allowsCollection: bool(o.allowsCollection),
    partNumber: str(o.partNumber, 120),
    location: str(o.location, 120),
    compatibilityNotes: str(o.compatibilityNotes, 2000),
    rawFitmentMentions: mentions,
    candidateFitments: candidates,
    resolvedFitments,
    needsReview,
    fieldSources: Object.keys(fieldSources).length ? fieldSources : undefined,
  };
}

export function parseImportedImages(raw: unknown): ImportedImage[] {
  if (!Array.isArray(raw)) return [];
  const images: ImportedImage[] = [];
  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const sourceUrl = str(rec.sourceUrl, 2048);
    const url = str(rec.url, 2048);
    const path = str(rec.path, 1024);
    if (sourceUrl && url && path) images.push({ sourceUrl, url, path });
  }
  return images;
}

/** jsonb round-trip helper — the types above are all JSON-safe by design. */
export function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}
