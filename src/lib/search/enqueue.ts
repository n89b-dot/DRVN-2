import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
export async function enqueueSearch(entity: string, id: string) {
  const result = await createAdminClient().rpc("enqueue_search_document", { p_entity: entity, p_id: id });
  if (result.error) throw new Error("Search change could not be queued");
}
