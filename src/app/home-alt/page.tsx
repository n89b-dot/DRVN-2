import type { Metadata } from "next";

import { Velocity } from "./Velocity";

export const metadata: Metadata = {
  title: "DRVN · Velocity — alternate home concept",
  description:
    "A motion-forward home-page concept for DRVN: cinematic hero, live marketplace ticker, tilting car spotlights, and a hidden launch-control easter egg.",
};

/**
 * Server entry for the `/home-alt` "Velocity" concept. Metadata is exported
 * here while all interactivity lives in the client `<Velocity />` composition.
 */
export default function HomeAltPage() {
  return <Velocity />;
}
