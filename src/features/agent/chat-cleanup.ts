import "server-only";

/**
 * What clearing the agent chat does once its rows are gone (N125), beyond
 * the database. Today that is nothing more: a photo sent in the chat is the
 * member's own `listing-images` upload, and "Listing from your photos" may
 * have put the very same file on a listing, so deleting it here would take
 * it off that listing too.
 *
 * Private chat attachments (R81) give chat photos a store of their own;
 * removing a cleared thread's attachments belongs in this function, which
 * clearAgentChat already calls after every successful clear and never after
 * a failed one.
 */
export async function afterChatCleared(ownerId: string): Promise<void> {
  void ownerId;
}
