import type { MetadataRoute } from "next";

import { OG_COLORS } from "@/lib/og/card";

/** The installable-app manifest. The icons are the generated `/icon/*`
 *  routes (see `./icon.tsx`); colours are the day sheet's ink and paper. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DRVN",
    short_name: "DRVN",
    description: "The home for your car and its build — builds and parts.",
    start_url: "/",
    display: "standalone",
    background_color: OG_COLORS.paper,
    theme_color: OG_COLORS.ink,
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
