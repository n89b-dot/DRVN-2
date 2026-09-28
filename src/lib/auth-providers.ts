import "server-only";

/**
 * Whether Google sign-in is switched on for this Supabase project, read from
 * the auth server's public settings. The "Continue with Google" button only
 * renders when it is: with the provider off, the button sent people to a raw
 * "Unsupported provider" JSON page with no way back. Turning Google on in
 * Supabase makes the button appear on its own. Cached for five minutes;
 * any failure reads as off.
 */
export async function googleSignInEnabled(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return false;
  try {
    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: key },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return false;
    const settings = (await response.json()) as { external?: { google?: boolean } };
    return settings.external?.google === true;
  } catch {
    return false;
  }
}
