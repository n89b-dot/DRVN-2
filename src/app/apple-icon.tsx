import { ImageResponse } from "next/og";

import { OgMonogram } from "@/lib/og/card";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** The home-screen icon: the same monogram at Apple's 180px. */
export default function AppleIcon() {
  return new ImageResponse(<OgMonogram side={size.width} />, size);
}
