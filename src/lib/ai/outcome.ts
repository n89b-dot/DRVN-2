/**
 * Whether a failed model request certainly cost nothing (OS-W04 follow-up).
 * Only a 4xx the SDK never retries (400, 401, 403, 404, 413, 422…) means the
 * provider refused the request before processing it. Anything else, an
 * abort, a timeout, a lost connection, a 5xx or a retried 408/409/429, may
 * have been processed and billed, so its spend is unknown and is charged at
 * the request's worst case rather than released.
 */
export function providerRejected(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500 && ![408, 409, 429].includes(status);
}
