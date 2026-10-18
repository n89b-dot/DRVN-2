import type { ReactNode } from "react";

import { ObjectRow } from "@/components/ui";

/**
 * A result card in the agent's thread (A3 design 02/05): an eyebrow saying
 * what it is, the object as a row, and the page it opens. A card only ever
 * opens the real page — it never holds a form (the plan's rule) — so a
 * listing card opens the listing, a negotiation card the offer.
 */
export function AgentResultCard({
  eyebrow,
  title,
  meta,
  image,
  href,
  action,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  image?: { src?: string; alt: string };
  href: string;
  /** Optional trailing action (Confirm and Edit arrive with "Update my build"). */
  action?: ReactNode;
}) {
  return (
    <article className="tile !p-4">
      <span className="microlabel">{eyebrow}</span>
      <ObjectRow href={href} media={image} title={title} meta={meta} actions={action} />
    </article>
  );
}
