/**
 * How a private agent chat photo is named (R81, OS-W08). A chat photo lives
 * in the private `agent-chat-photos` bucket at `<owner>/<uuid>.webp` and is
 * stored on the message as its Storage "authenticated" address, which serves
 * nothing without a signature. `agent_chat_append`
 * (20261107220300) accepts exactly this shape.
 */
export const AGENT_CHAT_BUCKET = "agent-chat-photos";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const REF = new RegExp(`^https?://[^/?#]+/storage/v1/object/authenticated/${AGENT_CHAT_BUCKET}/(${UUID})/(${UUID})\\.webp$`);

/** The address stored on the message for an object path `<owner>/<uuid>.webp`. */
export function chatPhotoRef(supabaseUrl: string, path: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/authenticated/${AGENT_CHAT_BUCKET}/${path}`;
}

/**
 * The object path a stored address names, or null if it isn't a chat photo
 * — or, given `ownerId`, isn't that member's own.
 */
export function chatPhotoPath(url: string, ownerId?: string): string | null {
  const match = REF.exec(url);
  if (!match) return null;
  if (ownerId && match[1] !== ownerId) return null;
  return `${match[1]}/${match[2]}.webp`;
}
