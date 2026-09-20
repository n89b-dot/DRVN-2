import type { ActivityBlock } from "@/lib/activity-blocks";

/**
 * The composer's browser-side copy of an unsent update — one per car (or per
 * post, when editing). It exists to survive a crash or a lost request; it is
 * also how the quick post hands over to the full editor (W-1), because it is
 * already the composer's own "pick up where you left off".
 */
export function composerRecoveryKey(id: string): string {
  return `drvn-composer:${id}`;
}

/**
 * Carry what was typed into the quick box over to the full editor.
 *
 * Only ever called when the car has NO saved draft: the composer prefers a
 * browser copy newer than the server's, so writing one over a real draft
 * would be exactly the merge W-1 forbids. Nothing goes in the URL — a
 * caption is somebody's words, and a URL is logged, cached and shared.
 */
export function handOffToComposer(carId: string, caption: string, photos: string[]): void {
  const blocks: ActivityBlock[] = [];
  if (caption.trim()) blocks.push({ type: "text", style: "normal", text: caption.trim() });
  if (photos.length) blocks.push({ type: "images", urls: photos });
  if (!blocks.length) return;
  try {
    localStorage.setItem(
      composerRecoveryKey(carId),
      JSON.stringify({ title: "", blocks, at: Date.now() })
    );
  } catch {
    // Storage blocked: the editor opens empty, which is what it did before.
  }
}
