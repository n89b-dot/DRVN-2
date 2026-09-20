import "server-only";

import { capture } from "@/lib/analytics";
import { reportError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";

import { parseExtraction } from "./schema";

/**
 * Marks an import consumed once the normal createListing action has really
 * written the listing (draft or published). Also computes the honest
 * extraction-quality signal: WHICH imported fields the seller changed before
 * saving — field names and counts only, never content (privacy §29).
 * Best-effort: a failure here never fails the listing save.
 */

export type SubmittedListingFields = {
  title: string;
  description: string | null;
  category: string;
  subcategory: string | null;
  condition: string;
  price_cents: number;
  shipping_cents: number;
  part_number: string | null;
  /** M-6 — recorded so the importer's accuracy can be compared against what
   *  the seller actually published, brand included. */
  brand?: string | null;
  location: string | null;
};

export async function consumeListingImport({
  userId,
  importId,
  listingId,
  published,
  submitted,
}: {
  userId: string;
  importId: string;
  listingId: string;
  published: boolean;
  submitted: SubmittedListingFields;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: row } = await admin
      .from("listing_imports")
      .select("id, status, source_adapter, source_mode, extracted")
      .eq("id", importId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!row || row.status !== "ready") return;

    const { data: moved, error } = await admin
      .from("listing_imports")
      .update({
        status: "consumed",
        listing_id: listingId,
        consumed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", importId)
      .eq("status", "ready")
      .select("id")
      .maybeSingle();
    if (error || !moved) {
      if (error) reportError("[listing-import] consume failed", { importId, error });
      return;
    }

    // Edited-field diff: only fields the extraction actually proposed count.
    const extraction = parseExtraction(row.extracted);
    const edited: string[] = [];
    if (extraction) {
      const differs = (field: string, proposed: unknown, actual: unknown) => {
        if (proposed === undefined) return;
        const a = typeof proposed === "string" ? proposed.trim() : proposed;
        const b = typeof actual === "string" ? actual.trim() : actual;
        if (a !== b && !(a === null && b === "") && !(a === "" && b === null)) edited.push(field);
      };
      differs("title", extraction.title, submitted.title);
      differs("description", extraction.description, submitted.description ?? "");
      differs("category", extraction.category, submitted.category);
      differs("subcategory", extraction.subcategory, submitted.subcategory ?? "");
      differs("condition", extraction.condition, submitted.condition);
      differs("price", extraction.priceCents, submitted.price_cents);
      differs(
        "shipping",
        extraction.shippingCents ?? (extraction.shippingIncluded ? 0 : undefined),
        submitted.shipping_cents
      );
      differs("part_number", extraction.partNumber, submitted.part_number ?? "");
      differs("location", extraction.location, submitted.location ?? "");
    }

    capture(userId, {
      event: "listing_import_consumed",
      props: {
        adapter: row.source_adapter ?? row.source_mode,
        published,
        fields_edited: edited.length,
        edited_fields: edited.join(","),
      },
    });
  } catch (error) {
    reportError("[listing-import] consume crashed", { importId, error });
  }
}
