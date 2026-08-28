import "server-only";

import { matchCatalogByName } from "@/lib/vehicles/catalog";

import type { CandidateFitment, ListingImportExtraction } from "./schema";

/**
 * Fitment resolution — raw enthusiast terminology flows through DRVN's real
 * vehicle architecture (the 0041 catalog), never a static chassis-code table:
 *
 *  - a candidate the catalog recognizes becomes a picker row (years only if
 *    the post stated them — nulls otherwise, for the seller to fill)
 *  - a mention nothing resolves stays verbatim in the compatibility notes,
 *    so no information is lost and nothing wrong is asserted
 *
 * Exact fitment is always seller-confirmed on review; the fitment review
 * issue from validate.ts guarantees the prompt.
 */

export type ResolvedFitment = {
  make: string;
  model: string;
  year_start: number | null;
  year_end: number | null;
};

export type FitmentResolution = {
  rows: ResolvedFitment[];
  /** Mentions/candidates the catalog couldn't confirm — preserved verbatim. */
  unresolved: string[];
};

export async function resolveImportFitments(
  extraction: ListingImportExtraction
): Promise<FitmentResolution> {
  const rows: ResolvedFitment[] = [];
  const unresolved: string[] = [];
  const seenRows = new Set<string>();
  const matchedSourceTexts = new Set<string>();

  const candidates: CandidateFitment[] = extraction.candidateFitments ?? [];
  for (const candidate of candidates.slice(0, 10)) {
    let matched = false;
    try {
      const { makeId, modelId } = await matchCatalogByName(candidate.make, candidate.model);
      matched = makeId !== null && modelId !== null;
    } catch {
      matched = false;
    }
    if (matched) {
      const key = `${candidate.make.toLowerCase()}|${candidate.model.toLowerCase()}|${candidate.year_start ?? ""}|${candidate.year_end ?? ""}`;
      if (!seenRows.has(key) && rows.length < 10) {
        seenRows.add(key);
        rows.push({
          make: candidate.make,
          model: candidate.model,
          year_start: candidate.year_start,
          year_end: candidate.year_end,
        });
      }
      matchedSourceTexts.add(candidate.sourceText.toLowerCase());
    } else {
      unresolved.push(candidate.sourceText);
    }
  }

  for (const mention of extraction.rawFitmentMentions) {
    const low = mention.toLowerCase();
    if (matchedSourceTexts.has(low)) continue;
    if (unresolved.some((u) => u.toLowerCase() === low)) continue;
    // A mention no candidate covered at all is unresolved by definition.
    if (!candidates.some((c) => c.sourceText.toLowerCase() === low)) unresolved.push(mention);
  }

  return { rows, unresolved: unresolved.slice(0, 12) };
}

/** Folds unresolved platform language into the compatibility notes verbatim. */
export function appendUnresolvedToNotes(
  notes: string | undefined,
  unresolved: string[]
): string | undefined {
  if (!unresolved.length) return notes;
  const line = `Stated fitment: ${unresolved.join(", ")}`;
  if (notes?.toLowerCase().includes(line.toLowerCase())) return notes;
  const combined = notes ? `${notes}\n${line}` : line;
  return combined.slice(0, 2000);
}
