import { createClient } from "@/lib/supabase/server";
import { isValidUsername, normalizeUsername } from "@/lib/username";

/**
 * Proactive username-availability check for onboarding. Usernames are
 * write-once (migration 0006 pins them after first set), so telling someone
 * it's taken *after* they submit is a worse experience than a small
 * debounced lookup while they type. No auth is required.
 *
 * N38 (OS-W34): the database answers (username_available, 20261107220500),
 * so reserved handles and those retired by deleted accounts read as taken
 * here exactly as they are refused on save — and which is which never shows.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = normalizeUsername(searchParams.get("username") ?? "");

  if (!isValidUsername(raw)) {
    return Response.json({ available: false, reason: "invalid" });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("username_available", { p_username: raw });

  if (error || typeof data !== "string") {
    // Fail open on infra errors — the server action re-validates on submit
    // anyway, so a stale "available" is corrected there, not left to stand.
    return Response.json({ available: true, reason: "unknown" });
  }

  if (data === "invalid") return Response.json({ available: false, reason: "invalid" });
  return Response.json({ available: data === "available" });
}
