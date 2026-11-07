import { createHash, timingSafeEqual } from "node:crypto";

// No "server-only" marker: this module is pure and unit-tested, and holds no
// secret of its own. Everything that calls it is a server route.

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/**
 * Constant-time equality for secrets. Both sides are hashed to a fixed
 * 32-byte digest before `timingSafeEqual`, so values of different lengths
 * neither throw nor return early on the length, and the time taken says
 * nothing about how much of the value matched. A missing or empty value on
 * either side never matches.
 */
export function secretsEqual(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (typeof provided !== "string" || typeof expected !== "string" || !provided || !expected) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}

/** Hex SHA-256 of a secret, for comparing with one the database holds. */
export function secretDigestHex(value: string): string {
  return digest(value).toString("hex");
}

/**
 * The door every scheduled job and protected health endpoint shares: the
 * request carries `Authorization: Bearer <CRON_SECRET>`. False when
 * CRON_SECRET is unset, so an unconfigured deployment refuses everyone.
 */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return secretsEqual(request.headers.get("authorization"), `Bearer ${secret}`);
}
