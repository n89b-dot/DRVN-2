import { createClient } from "@/lib/supabase/server";

/**
 * Proactive username-availability check for onboarding. Usernames are
 * write-once (migration 0006 pins them after first set), so telling someone
 * it's taken *after* they submit is a worse experience than a small
 * debounced lookup while they type. Read-only, publicly-readable column
 * (profile pages already resolve by username), so no auth is required.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = (searchParams.get("username") ?? "").trim().toLowerCase();

  if (!/^[a-z0-9_]{3,24}$/.test(raw)) {
    return Response.json({ available: false, reason: "invalid" });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", raw)
    .maybeSingle();

  if (error) {
    // Fail open on infra errors — the server action re-validates on submit
    // anyway, so a stale "available" is corrected there, not left to stand.
    return Response.json({ available: true, reason: "unknown" });
  }

  return Response.json({ available: !data });
}
