/**
 * N38 (OS-W34): the one username rule, the same as the database's
 * (profiles_username_format, 20261107220500): lowercase a-z, 0-9 and _,
 * 3 to 30 characters. The database also refuses reserved and retired
 * handles; username_available() checks all three.
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;
export const USERNAME_RULE_MESSAGE = `Username must be ${USERNAME_MIN}-${USERNAME_MAX} characters: lowercase letters, numbers, underscores.`;

/** What a member typed, the way it will be stored. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value);
}

/**
 * Where a profile link written with an old mixed-case handle should land:
 * the lowercase handle, query kept. Null when the handle is already
 * lowercase (N38 lowercased existing handles, so /u/Neil became /u/neil).
 */
export function canonicalProfilePath(handle: string, query: Record<string, string | undefined>): string | null {
  const lower = handle.toLowerCase();
  if (lower === handle) return null;
  const search = new URLSearchParams(
    Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  ).toString();
  return `/u/${encodeURIComponent(lower)}${search ? `?${search}` : ""}`;
}
