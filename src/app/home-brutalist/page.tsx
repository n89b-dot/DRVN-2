import type { Metadata } from "next";

import { Paddock } from "./Paddock";

export const metadata: Metadata = {
  title: "DRVN · Paddock — brutalist home concept",
  description:
    "A neo-brutalist home-page concept for DRVN (no glassmorphism): hard borders, offset shadows, oversized type, a square cursor, and a hidden scramble easter egg.",
};

/**
 * Server entry for the `/home-brutalist` "Paddock" concept. Metadata is
 * exported here while all interactivity lives in the client `<Paddock />`.
 */
export default function HomeBrutalistPage() {
  return <Paddock />;
}
