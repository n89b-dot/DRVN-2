import { getCategory } from "@/lib/marketplace/taxonomy";

import type {
  ImportReviewIssue,
  ListingImportExtraction,
  NormalizedImportSource,
} from "../schema";
import { parseExtraction } from "../schema";

/**
 * Server-side semantic validation of a model's (or the stub's) extraction —
 * the layer that makes non-invention a property of the SYSTEM rather than a
 * hope about the prompt:
 *
 *  - taxonomy: category/subcategory must resolve against the real taxonomy
 *  - money: normalized/bounded server-side
 *  - evidence checks: price, shipping-included, part number and location are
 *    DROPPED unless their content is actually present in the source material
 *  - review issues: specific "check this" reasons (never scores), derived
 *    here so the set is consistent regardless of which extractor ran
 */

export type FinalizeResult =
  | { ok: true; extraction: ListingImportExtraction }
  | { ok: false; code: "ai_invalid_output" | "source_not_sale_post" };

function searchable(source: NormalizedImportSource): string {
  return [
    source.title,
    source.text,
    source.structuredFacts?.priceText,
    source.structuredFacts?.location,
    source.structuredFacts?.partNumber,
    source.structuredFacts?.conditionText,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True when the integer-dollar (or exact cent) amount appears in the source. */
function amountAppears(cents: number, haystack: string): boolean {
  const dollars = Math.floor(cents / 100);
  const compactHay = haystack.replace(/[,\s]/g, "");
  if (compactHay.includes(String(dollars))) return true;
  if (cents % 100 !== 0 && compactHay.includes((cents / 100).toFixed(2))) return true;
  return false;
}

export function finalizeExtraction(
  raw: unknown,
  source: NormalizedImportSource
): FinalizeResult {
  const parsed = parseExtraction(raw);
  if (!parsed) return { ok: false, code: "ai_invalid_output" };
  if (!parsed.isSalePost) return { ok: false, code: "source_not_sale_post" };

  const hay = searchable(source);
  const issues: ImportReviewIssue[] = [];
  const sources: Record<string, string> = { ...(parsed.fieldSources ?? {}) };
  const extraction: ListingImportExtraction = { ...parsed, fieldSources: sources };

  // Taxonomy — the model cannot invent slugs.
  if (extraction.category) {
    const category = getCategory(extraction.category);
    if (!category) {
      extraction.category = undefined;
      extraction.subcategory = undefined;
    } else if (
      extraction.subcategory &&
      !category.subcategories.some((s) => s.slug === extraction.subcategory)
    ) {
      extraction.subcategory = undefined;
    }
  } else {
    extraction.subcategory = undefined;
  }
  if (extraction.category) sources.category ??= "ai_mapped";
  else issues.push({ field: "category", message: "Pick the category this part belongs in." });

  // Price — evidence-checked. A price with no trace in the post is invented.
  if (extraction.priceCents !== undefined) {
    if (!amountAppears(extraction.priceCents, hay)) {
      extraction.priceCents = undefined;
    } else {
      sources.price ??= source.structuredFacts?.priceText ? "structured_data" : "explicit_text";
    }
  }
  if (extraction.priceCents === undefined && !extraction.multipleItems) {
    issues.push({ field: "price", message: "We couldn't find a price. Set your asking price." });
  }

  // Shipping — "shipped" language keeps price whole with $0 shipping, but the
  // seller confirms; a shipping amount must appear in the post.
  if (extraction.shippingIncluded && !/ship/.test(hay)) {
    extraction.shippingIncluded = undefined;
    extraction.shippingCents = undefined;
  }
  if (
    extraction.shippingCents !== undefined &&
    extraction.shippingCents > 0 &&
    !amountAppears(extraction.shippingCents, hay)
  ) {
    extraction.shippingCents = undefined;
  }
  if (extraction.shippingIncluded) {
    issues.push({
      field: "shipping",
      message: 'The post says shipping is included ("shipped"). Confirm your shipping settings.',
    });
    sources.shipping ??= "explicit_text";
  }

  if (extraction.acceptsOffers) {
    issues.push({
      field: "offers",
      message: "The post mentions offers (OBO). Set the lowest offer you'd read, if any.",
    });
  }

  // Part number — verbatim evidence or gone.
  if (extraction.partNumber) {
    const needle = compact(extraction.partNumber);
    if (needle.length < 3 || !compact(hay).includes(needle)) {
      extraction.partNumber = undefined;
    } else {
      sources.part_number ??= source.structuredFacts?.partNumber ? "structured_data" : "explicit_text";
    }
  }

  // Location — stated or gone.
  if (extraction.location && !hay.includes(extraction.location.toLowerCase())) {
    const fromFacts = source.structuredFacts?.location?.toLowerCase();
    if (!fromFacts || !fromFacts.includes(extraction.location.toLowerCase())) {
      extraction.location = undefined;
    }
  }

  // Condition is a seller attestation domain — an inference from shorthand is
  // a starting point, never a settled fact.
  if (extraction.condition) {
    sources.condition ??= "ai_interpreted";
    issues.push({
      field: "condition",
      message: "Condition was read from the post's wording — confirm it, and grade the part yourself.",
    });
  }

  // Fitment always needs the seller's eyes: platform slang → real vehicles.
  if (extraction.rawFitmentMentions.length || extraction.candidateFitments?.length) {
    const quoted = extraction.rawFitmentMentions.slice(0, 4).map((m) => `"${m}"`).join(", ");
    issues.push({
      field: "fitment",
      message: quoted
        ? `We found ${quoted}. Confirm the exact vehicles and years.`
        : "Confirm the exact vehicles this fits.",
    });
    sources.fitment ??= "ai_interpreted";
  }

  if (extraction.title) sources.title ??= "ai_normalized";
  if (extraction.description) sources.description ??= "ai_normalized";

  // Merge: model-proposed issues first were parsed already; ours are the
  // canonical set. Dedupe by field+message, cap at 12.
  const seen = new Set<string>();
  extraction.needsReview = [...issues, ...parsed.needsReview].filter((issue) => {
    const key = `${issue.field}|${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);

  return { ok: true, extraction };
}
