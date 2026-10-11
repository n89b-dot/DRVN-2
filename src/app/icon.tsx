import { ImageResponse } from "next/og";

import { OgMonogram } from "@/lib/og/card";

/**
 * The favicon and the installable-app icons, one route: a `D` on an ink
 * plate (brand.md). `/icon/<id>` — 32 for the tab, 192 and 512 for the
 * manifest and home screens.
 */
const ICONS = [
  { id: "32", side: 32 },
  { id: "192", side: 192 },
  { id: "512", side: 512 },
] as const;

export function generateImageMetadata() {
  return ICONS.map(({ id, side }) => ({
    id,
    contentType: "image/png",
    size: { width: side, height: side },
  }));
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const wanted = String(await id);
  const side = ICONS.find((icon) => icon.id === wanted)?.side ?? 32;
  return new ImageResponse(<OgMonogram side={side} />, { width: side, height: side });
}
