import "server-only";

import { removeOwnerChatPhotos } from "@/lib/agent/chat-photos";
import { reportError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What clearing the agent chat does once its rows are gone (N125), beyond
 * the database: its photos go too (R81). Chat photos have their own private
 * bucket now, so nothing outside the chat uses them — a photo that became a
 * listing or update photo was copied to that public bucket when the draft
 * was opened. clearAgentChat calls this after every successful clear and
 * never after a failed one. Best-effort: anything left goes within the
 * agent sweep's 48 hours (agent_chat_photos_expired).
 */
export async function afterChatCleared(ownerId: string): Promise<void> {
  try {
    await removeOwnerChatPhotos(createAdminClient(), ownerId);
  } catch (error) {
    reportError("[agent] cleared chat photos not removed", error);
  }
}
