import { ImageResponse } from "next/og";

import { OG_SIZE, OgBrandCard } from "@/lib/og/card";

export const alt = "DRVN — builds and parts";
export const size = OG_SIZE;
export const contentType = "image/png";

/** The site card: the wordmark, the two front doors, the positioning line. */
export default function SiteCard() {
  return new ImageResponse(<OgBrandCard />, size);
}
