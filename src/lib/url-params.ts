/**
 * Query-preserving URL builder for filter/pagination links — the helper that
 * was copied verbatim into Saved, Messages and Notifications.
 *
 * Merges the current params with overrides, drops empty values, and omits the
 * `?` entirely when nothing survives — so the canonical state of every filter
 * is a clean path.
 */
export function withParams(
  basePath: string,
  params: Record<string, string | undefined>,
  overrides: Record<string, string | undefined> = {}
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}
