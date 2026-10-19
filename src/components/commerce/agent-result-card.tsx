import Link from "next/link";
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
  /** Trailing actions: Confirm and Edit on a confirm card. With actions the
   *  row isn't one link (a link can't hold buttons): the title and photo are. */
  action?: ReactNode;
}) {
  return (
    <article className="tile !p-4">
      <span className="microlabel">{eyebrow}</span>
      {action ? (
        <ObjectRow
          media={image}
          mediaHref={image ? href : undefined}
          title={
            <Link href={href} className="hover:text-live">
              {title}
            </Link>
          }
          meta={meta}
          actions={action}
        />
      ) : (
        <ObjectRow href={href} media={image} title={title} meta={meta} />
      )}
    </article>
  );
}
