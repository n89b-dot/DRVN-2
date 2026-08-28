"use server";

import { redirect } from "next/navigation";

import { capture } from "@/lib/analytics";
import { reportError } from "@/lib/monitoring";
import { RATE_LIMITS, allowAction, rateLimitMessage } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  advanceListingImport,
  toProgress,
  type ImportProgress,
} from "@/lib/listing-import/engine";
import { messageForImportError } from "@/lib/listing-import/errors";
import {
  canonicalizeImportUrl,
  parseImportUrl,
  policyFor,
} from "@/lib/listing-import/policy";
import { parseExtraction, toJson, type NormalizedImportSource } from "@/lib/listing-import/schema";

/**
 * Importer actions — thin, auth-gated shells over the engine
 * (src/lib/listing-import/engine.ts). All heavy work happens in engine steps
 * the client polls via `pollImport`; these actions only create/patch rows the
 * caller owns. Nothing here creates a listing.
 */

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export type ImportStartState = {
  error?: string;
  importId?: string;
  /** URL is real but the site is paste-only — show the paste path, keep the
   *  URL as provenance. Not an error. */
  pasteRequired?: { url: string; label: string };
  resumed?: boolean;
} | null;

const MIN_PASTE_CHARS = 25;
const MAX_PASTE_CHARS = 20_000;

/**
 * One-time content-rights acknowledgement: required before the first import,
 * remembered on the account afterwards (profiles.import_attested_at, 0047).
 */
async function ensureAttested(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  formData: FormData
): Promise<string | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("import_attested_at")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.import_attested_at) return null;
  if (formData.get("attest_ownership") !== "on") {
    return "Confirm this is your own listing (or content you have permission to use) to import it.";
  }
  const { error } = await supabase
    .from("profiles")
    .update({ import_attested_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) reportError("[listing-import] attestation save failed", { userId, error });
  return null;
}

export async function startUrlImport(
  _prev: ImportStartState,
  formData: FormData
): Promise<ImportStartState> {
  const { supabase, user } = await requireUser();

  if (!(await allowAction(RATE_LIMITS.importListing, user.id))) {
    return { error: rateLimitMessage(RATE_LIMITS.importListing) };
  }

  const attestError = await ensureAttested(supabase, user.id, formData);
  if (attestError) return { error: attestError };

  const url = parseImportUrl(String(formData.get("source_url") ?? ""));
  if (!url) return { error: "That doesn't look like a listing link. Check the URL and try again." };

  const policy = policyFor(url);
  if (policy.mode === "paste_only") {
    // Not an error: the same import continues through paste, URL kept.
    return { pasteRequired: { url: url.href, label: policy.label } };
  }
  if (policy.mode === "unsupported") {
    return { error: messageForImportError("source_unsupported") };
  }

  const canonical = canonicalizeImportUrl(url);
  const admin = createAdminClient();

  // Dedupe: a live import for the same listing resumes instead of re-running.
  const { data: existing } = await admin
    .from("listing_imports")
    .select("id, status")
    .eq("user_id", user.id)
    .eq("canonical_url", canonical)
    .in("status", ["pending", "fetching", "extracting", "importing_media", "ready"])
    .maybeSingle();
  if (existing) return { importId: existing.id, resumed: true };

  const { data: created, error } = await admin
    .from("listing_imports")
    .insert({
      user_id: user.id,
      source_mode: "url",
      source_adapter: policy.adapterId,
      source_url: url.href,
      canonical_url: canonical,
      source_domain: url.hostname.toLowerCase().replace(/^www\./, ""),
    })
    .select("id")
    .single();
  if (error || !created) {
    // A racing duplicate insert hits the partial unique index — resume it.
    if (error?.code === "23505") {
      const { data: raced } = await admin
        .from("listing_imports")
        .select("id")
        .eq("user_id", user.id)
        .eq("canonical_url", canonical)
        .in("status", ["pending", "fetching", "extracting", "importing_media", "ready"])
        .maybeSingle();
      if (raced) return { importId: raced.id, resumed: true };
    }
    reportError("[listing-import] create failed", { error });
    return { error: "We couldn't start the import. Try again in a moment." };
  }

  capture(user.id, {
    event: "listing_import_started",
    props: { mode: "url", adapter: policy.adapterId },
  });
  return { importId: created.id };
}

export async function startPasteImport(
  _prev: ImportStartState,
  formData: FormData
): Promise<ImportStartState> {
  const { supabase, user } = await requireUser();

  if (!(await allowAction(RATE_LIMITS.importListing, user.id))) {
    return { error: rateLimitMessage(RATE_LIMITS.importListing) };
  }

  const attestError = await ensureAttested(supabase, user.id, formData);
  if (attestError) return { error: attestError };

  const text = String(formData.get("post_text") ?? "").trim();
  if (text.length < MIN_PASTE_CHARS) {
    return { error: "Paste the whole post — title, price, description, the lot." };
  }
  if (text.length > MAX_PASTE_CHARS) {
    return { error: "That's too much text — trim it to the sale post itself." };
  }

  // Optional provenance from a paste-only or failed URL.
  const provenance = parseImportUrl(String(formData.get("source_url") ?? ""));
  const source: NormalizedImportSource = {
    sourceType: "paste",
    sourceUrl: provenance?.href,
    sourceDomain: provenance?.hostname.toLowerCase().replace(/^www\./, ""),
    text,
    images: [],
    fetchMethod: "paste",
  };

  const admin = createAdminClient();
  const { data: created, error } = await admin
    .from("listing_imports")
    .insert({
      user_id: user.id,
      source_mode: "paste",
      source_adapter: "paste",
      source_url: provenance?.href ?? null,
      source_domain: source.sourceDomain ?? null,
      normalized_source: toJson(source),
    })
    .select("id")
    .single();
  if (error || !created) {
    reportError("[listing-import] paste create failed", { error });
    return { error: "We couldn't start the import. Try again in a moment." };
  }

  capture(user.id, { event: "listing_import_started", props: { mode: "paste", adapter: "paste" } });
  return { importId: created.id };
}

/**
 * Fallback for a URL import the source refused: the seller pastes the post
 * they already wrote, the SAME import continues — provenance, adapter and
 * progress all kept.
 */
export async function providePasteFallback(
  _prev: ImportStartState,
  formData: FormData
): Promise<ImportStartState> {
  const { user } = await requireUser();

  const importId = String(formData.get("import_id") ?? "");
  const text = String(formData.get("post_text") ?? "").trim();
  if (!importId) return { error: "We lost track of this import — start again." };
  if (text.length < MIN_PASTE_CHARS) {
    return { error: "Paste the whole post — title, price, description, the lot." };
  }
  if (text.length > MAX_PASTE_CHARS) {
    return { error: "That's too much text — trim it to the sale post itself." };
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("listing_imports")
    .select("*")
    .eq("id", importId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) return { error: messageForImportError("import_not_found") };
  if (row.status !== "failed") return { importId: row.id };

  const source: NormalizedImportSource = {
    sourceType: "paste",
    sourceUrl: row.source_url ?? undefined,
    canonicalUrl: row.canonical_url ?? undefined,
    sourceDomain: row.source_domain ?? undefined,
    text,
    images: [],
    fetchMethod: "paste",
  };

  const { data: moved, error } = await admin
    .from("listing_imports")
    .update({
      status: "extracting",
      normalized_source: toJson(source),
      extracted: null,
      selected_item: null,
      error_code: null,
      error_detail: null,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", importId)
    .eq("status", "failed")
    .select("id")
    .maybeSingle();
  if (error || !moved) {
    reportError("[listing-import] paste fallback failed", { importId, error });
    return { error: "We couldn't continue this import. Start a fresh one." };
  }

  capture(user.id, {
    event: "listing_import_fallback_to_paste",
    props: { adapter: row.source_adapter ?? "generic" },
  });
  return { importId };
}

/** One engine step + current progress. The client polls this until `ready`. */
export async function pollImport(importId: string): Promise<ImportProgress | { error: string }> {
  const { user } = await requireUser();
  if (typeof importId !== "string" || !importId) {
    return { error: messageForImportError("import_not_found") };
  }
  const progress = await advanceListingImport(importId, user.id);
  if (!progress) return { error: messageForImportError("import_not_found") };
  return progress;
}

/** Retry a failed step. The engine resumes from whatever survived. */
export async function retryImport(importId: string): Promise<ImportProgress | { error: string }> {
  const { user } = await requireUser();
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("listing_imports")
    .select("*")
    .eq("id", importId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) return { error: messageForImportError("import_not_found") };
  if (row.status === "failed") {
    const target = row.normalized_source ? "extracting" : "fetching";
    await admin
      .from("listing_imports")
      .update({
        status: target,
        attempts: row.attempts + 1,
        error_code: null,
        error_detail: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", importId)
      .eq("status", "failed");
  }
  const progress = await advanceListingImport(importId, user.id);
  return progress ?? { error: messageForImportError("import_not_found") };
}

/** Multi-item post: the seller picked one item; re-extract focused on it. */
export async function chooseImportItem(
  importId: string,
  itemIndex: number
): Promise<ImportProgress | { error: string }> {
  const { user } = await requireUser();
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("listing_imports")
    .select("*")
    .eq("id", importId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) return { error: messageForImportError("import_not_found") };

  const extraction = parseExtraction(row.extracted);
  const items = extraction?.items ?? [];
  if (
    row.status !== "ready" ||
    !extraction?.multipleItems ||
    !Number.isInteger(itemIndex) ||
    itemIndex < 0 ||
    itemIndex >= items.length
  ) {
    return toProgress(row);
  }

  const { data: moved } = await admin
    .from("listing_imports")
    .update({
      status: "extracting",
      selected_item: itemIndex,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", importId)
    .eq("status", "ready")
    .select("id")
    .maybeSingle();
  if (!moved) return toProgress(row);

  const progress = await advanceListingImport(importId, user.id);
  return progress ?? { error: messageForImportError("import_not_found") };
}
