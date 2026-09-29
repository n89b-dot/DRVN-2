import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/**
 * What a suspended member is told when a post, reply, message, question or
 * offer is refused. The database is what refuses (restrictive policies in
 * 20260928182300, 20260929110000 and 20260929120000); this
 * turns its bare denial into a sentence. The reason itself is in the
 * notification sent when the account was suspended.
 */
export const SUSPENDED_MESSAGE =
  "Your account is suspended, so you can't post, reply, message, ask questions or make offers right now. Your notifications say why.";

/** Checked only after a write fails, so the happy path pays nothing.
 *  `profiles.suspended_at` isn't readable by members, so this asks the same
 *  `is_suspended` function the policies use. */
export async function isSuspended(supabase: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { data } = await supabase.rpc("is_suspended", { uid: userId });
  return data === true;
}
