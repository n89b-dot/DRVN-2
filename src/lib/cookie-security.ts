/** Production cookies stay Secure. Only the explicitly isolated HTTP test
 * stack may relax this, because WebKit correctly rejects Secure cookies on HTTP. */
export function secureCookies(env: Record<string, string | undefined> = process.env): boolean {
  if (env.NODE_ENV !== "production") return false;
  try {
    const site = new URL(env.NEXT_PUBLIC_SITE_URL || "");
    const database = new URL(env.NEXT_PUBLIC_SUPABASE_URL || "");
    if (env.E2E_TEST_PROJECT_REF === "local-drvn-remediation" &&
        site.protocol === "http:" && ["localhost", "127.0.0.1"].includes(site.hostname) &&
        database.protocol === "http:" && ["localhost", "127.0.0.1"].includes(database.hostname) && database.port === "54321") return false;
  } catch { /* Missing or invalid configuration never relaxes production cookies. */ }
  return true;
}
