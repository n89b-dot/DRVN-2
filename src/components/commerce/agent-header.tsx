import type { ReactNode } from "react";

import { Badge, PageHead } from "@/components/ui";

/**
 * The agent's header (A3 design 02): "Agent", a Beta label until auto-accept
 * graduates, and one line saying what it is doing ("Handling offers on 3
 * listings · 2 need you"). The full-screen /agent today; the desktop side
 * panel reuses it in A3c.
 */
export function AgentHeader({ status, className }: { status: ReactNode; className?: string }) {
  return (
    <PageHead
      className={className}
      title={
        <span className="inline-flex flex-wrap items-center gap-3">
          Agent
          <Badge>Beta</Badge>
        </span>
      }
      sub={status}
    />
  );
}
