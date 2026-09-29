import "server-only";

import { capture } from "@/lib/analytics";
import type { ListingImport, ListingImportStatus } from "@/lib/database.types";
import { reportError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";

import { fetchNormalizedSource } from "./adapters";
import { resolveImportConfig } from "./config";
import { messageForImportError, PASTE_FALLBACK_CODES, RETRYABLE_CODES, type ImportErrorCode } from "./errors";
import { extractListing } from "./extract/ai";
import { finalizeExtraction, foreignPrice } from "./extract/validate";
import { appendUnresolvedToNotes, resolveImportFitments } from "./fitment";
import { importListingImages } from "./media/import-images";
import { parseImportUrl, policyFor } from "./policy";
import {
  parseExtraction,
  parseImportedImages,
  parseNormalizedSource,
  toJson,
  type ListingImportExtraction,
  type NormalizedImportSource,
} from "./schema";

/**
 * The durable step executor (0047). Each `advanceListingImport` call performs
 * ONE bounded unit of work and returns; the UI polls until the row is
 * `ready`. The row is the state machine — a crashed request leaves a row that
 * the next call reclaims (stale-claim window) and every step is idempotent:
 * a re-run fetch overwrites the same normalized_source, a re-run media pass
 * skips source URLs already imported, and a re-run extraction replaces the
 * previous answer. No step ever creates a listing.
 */

/** Lease length for one step — after this a crashed request's claim lapses. */
const LEASE_MS = 3 * 60 * 1000;
/** Media downloads per advance call — keeps each request comfortably bounded. */
const IMAGES_PER_STEP = 4;

const WORKING_STATUSES: ListingImportStatus[] = ["fetching", "extracting", "importing_media"];

export type ImportProgress = {
  id: string;
  status: ListingImportStatus;
  /** Seller-facing source name ("Facebook Marketplace", "golfmk7.com"). */
  sourceLabel: string;
  adapter: string | null;
  sourceUrl: string | null;
  /** True while a poll should call advance again. */
  working: boolean;
  /** The productive next step is pasting the post text. */
  needsPaste: boolean;
  retryable: boolean;
  errorMessage: string | null;
  multipleItems: boolean;
  items: { label: string; priceText?: string }[] | null;
  imagesImported: number;
};

type Admin = ReturnType<typeof createAdminClient>;

export function sourceLabelFor(row: Pick<ListingImport, "source_adapter" | "source_domain" | "source_mode">): string {
  if (row.source_adapter === "facebook") return "Facebook Marketplace";
  if (row.source_mode === "paste" || row.source_adapter === "paste") return "your pasted post";
  return row.source_domain ?? "the source page";
}

export function toProgress(row: ListingImport): ImportProgress {
  const extraction = parseExtraction(row.extracted);
  const failedCode = row.status === "failed" ? row.error_code : null;
  return {
    id: row.id,
    status: row.status,
    sourceLabel: sourceLabelFor(row),
    adapter: row.source_adapter,
    sourceUrl: row.source_url,
    working: row.status === "pending" || WORKING_STATUSES.includes(row.status),
    needsPaste: Boolean(
      failedCode && PASTE_FALLBACK_CODES.has(failedCode as ImportErrorCode) && row.source_mode === "url"
    ),
    retryable: Boolean(failedCode && RETRYABLE_CODES.has(failedCode as ImportErrorCode)),
    errorMessage: row.status === "failed" ? messageForImportError(row.error_code) : null,
    multipleItems: Boolean(extraction?.multipleItems && row.selected_item === null),
    items:
      extraction?.multipleItems && row.selected_item === null && extraction.items?.length
        ? extraction.items.map((i) => ({ label: i.label, priceText: i.priceText }))
        : null,
    imagesImported: parseImportedImages(row.imported_images).length,
  };
}

async function loadOwnImport(
  admin: Admin,
  importId: string,
  userId: string
): Promise<ListingImport | null> {
  const { data } = await admin
    .from("listing_imports")
    .select("*")
    .eq("id", importId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

/** Compare-and-set transition; false = someone else moved the row first. */
async function transition(
  admin: Admin,
  row: ListingImport,
  from: ListingImportStatus,
  to: ListingImportStatus,
  patch: Partial<ListingImport> = {}
): Promise<boolean> {
  const { data, error } = await admin
    .from("listing_imports")
    // A completed transition always releases the step lease.
    .update({ status: to, lease_expires_at: null, updated_at: new Date().toISOString(), ...patch })
    .eq("id", row.id)
    .eq("status", from)
    .select("id")
    .maybeSingle();
  if (error) {
    reportError("[listing-import] transition failed", { importId: row.id, from, to, error });
    return false;
  }
  return Boolean(data);
}

async function fail(
  admin: Admin,
  row: ListingImport,
  from: ListingImportStatus,
  code: ImportErrorCode,
  detail?: string
): Promise<void> {
  await transition(admin, row, from, "failed", {
    error_code: code,
    error_detail: detail?.slice(0, 2000) ?? null,
  });
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function stepFetch(admin: Admin, row: ListingImport, userId: string): Promise<void> {
  const config = resolveImportConfig();
  const url = row.source_url ? parseImportUrl(row.source_url) : null;
  if (!url) {
    await fail(admin, row, "fetching", "source_invalid");
    return;
  }
  const policy = policyFor(url);

  if (policy.adapterId === "facebook") {
    capture(userId, { event: "listing_import_facebook_outcome", props: { outcome: "fetch_attempted" } });
  }

  const outcome = await fetchNormalizedSource(policy, url, {
    allowPrivate: config.allowPrivateHosts,
    browserEnabled: config.browserEnabled,
  });

  if (policy.adapterId === "facebook") {
    const renderAttempted =
      (outcome.ok && outcome.rendered) || (!outcome.ok && outcome.attemptedRender);
    if (renderAttempted) {
      capture(userId, { event: "listing_import_facebook_outcome", props: { outcome: "render_attempted" } });
    }
  }

  if (!outcome.ok) {
    capture(userId, {
      event: "listing_import_fetch_failed",
      props: { adapter: outcome.adapter, code: outcome.code },
    });
    if (outcome.adapter === "facebook" && outcome.code === "source_listing_gone") {
      // Not a verdict on anonymous retrieval — the listing itself is gone.
      capture(userId, { event: "listing_import_facebook_outcome", props: { outcome: "listing_gone" } });
    } else if (outcome.adapter === "facebook" && PASTE_FALLBACK_CODES.has(outcome.code)) {
      capture(userId, { event: "listing_import_facebook_outcome", props: { outcome: "fallback_to_paste" } });
    }
    await fail(admin, row, "fetching", outcome.code, outcome.detail);
    return;
  }

  capture(userId, {
    event: "listing_import_fetch_succeeded",
    props: {
      adapter: outcome.adapter,
      fetch_method: outcome.source.fetchMethod === "render" ? "render" : "http",
      images: outcome.source.images.length,
    },
  });
  if (outcome.adapter === "facebook") {
    capture(userId, {
      event: "listing_import_facebook_outcome",
      props: { outcome: outcome.rendered ? "render_succeeded" : "fetch_succeeded" },
    });
  }

  await transition(admin, row, "fetching", "extracting", {
    source_adapter: outcome.adapter,
    normalized_source: toJson(outcome.source),
    source_domain: outcome.source.sourceDomain ?? row.source_domain,
    canonical_url: outcome.source.canonicalUrl ?? row.canonical_url,
    error_code: null,
    error_detail: null,
  });
}

async function stepExtract(admin: Admin, row: ListingImport, userId: string): Promise<void> {
  const source = parseNormalizedSource(row.normalized_source);
  if (!source) {
    await fail(admin, row, "extracting", "source_parse_failed");
    return;
  }

  const config = resolveImportConfig();

  // Multi-item re-extraction: the seller chose one item — focus the source.
  const previous = parseExtraction(row.extracted);
  let focusedSource: NormalizedImportSource = source;
  if (row.selected_item !== null && previous?.items?.[row.selected_item]) {
    const item = previous.items[row.selected_item];
    focusedSource = {
      ...source,
      title: item.label,
      text: `The seller is listing ONE item from this post: "${item.label}"${item.priceText ? ` (${item.priceText})` : ""}.\nExtract only that item.\n\n${source.text}`,
    };
  }

  const aiOutcome = await extractListing(focusedSource, config);
  if (!aiOutcome.ok) {
    await fail(admin, row, "extracting", aiOutcome.code);
    return;
  }

  const finalized = finalizeExtraction(aiOutcome.raw, focusedSource);
  if (!finalized.ok) {
    await fail(admin, row, "extracting", finalized.code);
    return;
  }

  let extraction: ListingImportExtraction = finalized.extraction;

  // When one item was selected, the multi-item flags no longer apply — and
  // the item's own stated price text is evidence enough to backstop a price
  // the focused extraction missed (deterministic, from the post, not a guess).
  if (row.selected_item !== null) {
    const chosen = previous?.items?.[row.selected_item];
    extraction = { ...extraction, multipleItems: false, items: previous?.items };
    if (extraction.priceCents === undefined && chosen?.priceText && !foreignPrice(focusedSource)) {
      const match = /\$?\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?/.exec(chosen.priceText);
      if (match) {
        extraction.priceCents =
          parseInt(match[1].replaceAll(",", ""), 10) * 100 +
          (match[2] ? parseInt(match[2], 10) : 0);
        extraction.needsReview = [
          ...extraction.needsReview.filter((issue) => issue.field !== "price"),
          { field: "price", message: `Taken from "${chosen.priceText.trim()}" in your post — confirm.` },
        ];
      }
    }
    if (!extraction.title && chosen?.label) extraction.title = chosen.label.slice(0, 140);
  }

  // Fitment through the real vehicle catalog (0041) — unresolved platform
  // language survives verbatim in the notes.
  try {
    const resolution = await resolveImportFitments(extraction);
    extraction = {
      ...extraction,
      resolvedFitments: resolution.rows,
      compatibilityNotes: appendUnresolvedToNotes(extraction.compatibilityNotes, resolution.unresolved),
    };
  } catch (error) {
    reportError("[listing-import] fitment resolution failed", { importId: row.id, error });
  }

  capture(userId, {
    event: "listing_import_extraction_succeeded",
    props: {
      adapter: row.source_adapter ?? row.source_mode,
      multiple_items: extraction.multipleItems,
      needs_review: extraction.needsReview.length,
    },
  });

  // Media only applies to fetched sources with candidates and a settled item
  // choice; paste-mode photos arrive through the normal browser uploader.
  const wantsMedia =
    source.fetchMethod !== "paste" &&
    source.images.length > 0 &&
    !(extraction.multipleItems && row.selected_item === null);

  await transition(admin, row, "extracting", wantsMedia ? "importing_media" : "ready", {
    extracted: toJson(extraction),
    error_code: null,
    error_detail: null,
    ...(wantsMedia ? {} : { completed_at: new Date().toISOString() }),
  });
}

async function stepMedia(admin: Admin, row: ListingImport, userId: string): Promise<void> {
  const source = parseNormalizedSource(row.normalized_source);
  if (!source) {
    await transition(admin, row, "importing_media", "ready", {
      completed_at: new Date().toISOString(),
    });
    return;
  }

  const config = resolveImportConfig();
  const already = parseImportedImages(row.imported_images);
  const remaining = source.images.filter((c) => !already.some((d) => d.sourceUrl === c.url));
  const batch = remaining.slice(0, IMAGES_PER_STEP);

  const result = await importListingImages({
    userId,
    importId: row.id,
    candidates: batch,
    alreadyImported: already,
    allowPrivate: config.allowPrivateHosts,
  });

  const total = result.images.length;
  const exhausted =
    batch.length === remaining.length || total >= 12 || batch.length === 0;

  if (exhausted) {
    await transition(admin, row, "importing_media", "ready", {
      imported_images: toJson(result.images),
      completed_at: new Date().toISOString(),
    });
  } else {
    // Stay in importing_media; release the lease so the next poll continues.
    await admin
      .from("listing_imports")
      .update({
        imported_images: toJson(result.images),
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "importing_media");
  }
}

// ---------------------------------------------------------------------------
// The public advance/step entry point
// ---------------------------------------------------------------------------

export async function advanceListingImport(importId: string, userId: string): Promise<ImportProgress | null> {
  const admin = createAdminClient();
  let row = await loadOwnImport(admin, importId, userId);
  if (!row) return null;

  // Time-based expiry is enforced on touch, the sweep catches the rest.
  if (
    row.status !== "consumed" &&
    row.status !== "expired" &&
    new Date(row.expires_at).getTime() < Date.now()
  ) {
    await transition(admin, row, row.status, "expired");
    row = (await loadOwnImport(admin, importId, userId)) ?? row;
    return toProgress(row);
  }

  if (row.status !== "pending" && !WORKING_STATUSES.includes(row.status)) {
    return toProgress(row);
  }

  // Claim the step lease — the loser of a concurrent poll just reports state.
  const now = new Date();
  const { data: claimed } = await admin
    .from("listing_imports")
    .update({
      lease_expires_at: new Date(now.getTime() + LEASE_MS).toISOString(),
      attempts: row.attempts + 1,
    })
    .eq("id", row.id)
    .eq("status", row.status)
    .or(`lease_expires_at.is.null,lease_expires_at.lt.${now.toISOString()}`)
    .select("id")
    .maybeSingle();
  if (!claimed) return toProgress(row);

  if (row.status === "pending") {
    const next: ListingImportStatus = row.source_mode === "paste" ? "extracting" : "fetching";
    const moved = await transition(admin, row, "pending", next, {
      lease_expires_at: new Date(now.getTime() + LEASE_MS).toISOString(),
    });
    if (!moved) return toProgress((await loadOwnImport(admin, importId, userId)) ?? row);
    row = { ...row, status: next };
  }

  try {
    if (row.status === "fetching") await stepFetch(admin, row, userId);
    else if (row.status === "extracting") await stepExtract(admin, row, userId);
    else if (row.status === "importing_media") await stepMedia(admin, row, userId);
  } catch (error) {
    reportError("[listing-import] step crashed", { importId, status: row.status, error });
    await fail(
      admin,
      row,
      row.status,
      row.status === "fetching" ? "source_fetch_failed" : row.status === "extracting" ? "ai_failed" : "media_fetch_failed"
    );
  }

  const after = await loadOwnImport(admin, importId, userId);
  return after ? toProgress(after) : null;
}
