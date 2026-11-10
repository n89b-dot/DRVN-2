import { anyUnsignedMemberPhoto } from "@/lib/photo-copies";

/** The two kinds of card the sign-in pages' backdrop draws, as far as their photos go. */
export type BackdropPhotoCard = { kind: "listing"; listing: { cover_url: string | null } } | { kind: "build"; build: { cover_image_url: string | null } };

/**
 * Whether a set of backdrop cards may be kept for the next visitor: every
 * photo it draws is signed. It looks at the photo fields themselves, one per
 * card. A search of the whole value would be wrong both ways: a seller can
 * write a photo's stored address into a title, and that would stop a good
 * set being kept (review of #244).
 */
export function backdropKeepable(cards: readonly BackdropPhotoCard[]): boolean {
  return !anyUnsignedMemberPhoto(cards.map((card) => (card.kind === "listing" ? card.listing.cover_url : card.build.cover_image_url)));
}
