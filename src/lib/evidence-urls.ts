import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "dispute-evidence";
const SIGNED_URL_TTL_SECONDS = 600; // 10 minutes — long enough to render a page, short enough that a leaked link dies fast.

/**
 * The dispute-evidence bucket went private in 0027 (P0: it used to be
 * public — see supabase/migrations/0027_evidence_privacy.sql). Rows written
 * before that carry a full public URL in `url`; rows written after carry a
 * `storage_path` too. This derives the bare object path (`{uid}/{file}`,
 * the argument `createSignedUrl` wants) from whichever the row has.
 *
 * Pure and exported so it's unit-testable without a network call — see
 * evidence-urls.test.ts.
 */
export function deriveEvidenceStoragePath(
  row: { url?: string | null; storage_path?: string | null } | string
): string | null {
  const explicit = typeof row === "string" ? null : row.storage_path;
  if (explicit) return explicit;

  const url = typeof row === "string" ? row : row.url;
  if (!url) return null;

  // Already a bare path (no scheme) — accept as-is if it looks like
  // '{uid}/{filename}' (before 20261107203000) or '{uid}/{order}/{filename}'.
  if (!/^https?:\/\//i.test(url)) {
    return /^[^/]+\/(?:[^/]+\/)?[^/]+$/.test(url) ? url : null;
  }

  try {
    const parsed = new URL(url);
    // Public URL: /storage/v1/object/public/dispute-evidence/{uid}/{file}
    // Signed URL: /storage/v1/object/sign/dispute-evidence/{uid}/{file}?token=...
    // Authenticated (download) form uses /object/authenticated/...
    const match = parsed.pathname.match(
      /\/storage\/v1\/object\/(?:public|sign|authenticated)\/dispute-evidence\/(.+)$/
    );
    if (!match) return null;
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export type EvidenceRow<T> = T & { url: string; storage_path?: string | null };

/**
 * Replaces each row's stale public/stored URL with a short-lived signed one.
 * Rows whose path can't be derived, or that Storage refuses to sign (object
 * deleted, bucket misconfigured), fall back to their original `url` — the
 * caller renders a dead thumbnail rather than crashing the page over one bad
 * row.
 */
export async function signEvidenceUrls<T extends { url: string; storage_path?: string | null }>(
  admin: SupabaseClient,
  rows: T[]
): Promise<T[]> {
  if (rows.length === 0) return rows;

  const paths = rows.map((row) => deriveEvidenceStoragePath(row));
  const uniquePaths = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  if (uniquePaths.length === 0) return rows;

  const { data } = await admin.storage.from(BUCKET).createSignedUrls(uniquePaths, SIGNED_URL_TTL_SECONDS);
  const signedByPath = new Map<string, string>();
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) signedByPath.set(entry.path, entry.signedUrl);
  }

  return rows.map((row, i) => {
    const path = paths[i];
    const signed = path ? signedByPath.get(path) : undefined;
    return signed ? { ...row, url: signed } : row;
  });
}
