import "server-only";

import { reportError } from "@/lib/monitoring";

/**
 * Shared Typesense transport (brief §25) — the one piece of the search
 * engine integration that is genuinely product-agnostic: env-gated
 * configuration, plain-fetch requests with a hard timeout, and
 * fail-soft-by-reporting semantics. Both the marketplace listing search and
 * the Explore search collections speak through this seam; everything that
 * knows about documents, collections or ranking stays with its domain.
 *
 *   TYPESENSE_URL      e.g. http://localhost:8108
 *   TYPESENSE_API_KEY
 *
 * PostgreSQL remains canonical truth everywhere: Typesense collections are
 * disposable projections, and any transport failure is an error to report
 * and fall back from, never to surface.
 */

export function typesenseConfigured(): boolean {
  return Boolean(process.env.TYPESENSE_URL && process.env.TYPESENSE_API_KEY);
}

export function typesenseHeaders(): Record<string, string> {
  return {
    "X-TYPESENSE-API-KEY": process.env.TYPESENSE_API_KEY ?? "",
    "Content-Type": "application/json",
  };
}

const TIMEOUT_MS = 3000;

/**
 * One request to the engine. Throws on non-2xx or timeout — callers decide
 * whether that means "fall back" (queries) or "report and move on" (sync).
 */
export async function typesenseRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${process.env.TYPESENSE_URL}${path}`, {
    ...init,
    headers: { ...typesenseHeaders(), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`typesense ${res.status}`);
  return res;
}

/** Fire-and-forget upsert of one document — no-op unless configured. */
export async function typesenseUpsert(collection: string, doc: object & { id: string }): Promise<void> {
  if (!typesenseConfigured()) return;
  try {
    await typesenseRequest(`/collections/${collection}/documents?action=upsert`, {
      method: "POST",
      body: JSON.stringify(doc),
    });
  } catch (error) {
    reportError("[search] typesense upsert failed", {
      collection,
      id: doc.id,
      error: String(error),
    });
  }
}

/** Fire-and-forget delete — a stale document is filtered out at query time anyway. */
export async function typesenseDelete(collection: string, id: string): Promise<void> {
  if (!typesenseConfigured()) return;
  try {
    await typesenseRequest(`/collections/${collection}/documents/${id}`, { method: "DELETE" });
  } catch {
    // Missing document / transient failure: the canonical query path never
    // trusts the index alone, so silence is safe here.
  }
}
