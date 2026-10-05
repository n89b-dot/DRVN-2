import Link from "next/link";

import { BeforeAfter, ConsentVideo, Media } from "@/components/ui";
import {
  MOD_ACTIONS,
  PERFORMANCE_KINDS,
  type ActivityBlock,
} from "@/lib/activity-blocks";

/**
 * ActivityBlocksView — the one renderer for DRVN's activity document model
 * (all versions; feed it normalizeBlocks output). Server-renderable; the only
 * client islands inside are the BeforeAfter slider and the click-to-load
 * video (ConsentVideo). Used by the public post
 * page and anywhere else a post body renders — the composer previews through
 * the same idioms, so published output never surprises the author.
 */

export type ModLink = { href: string; label: string };

export function ActivityBlocksView({
  blocks,
  title,
  /** Optional per-mod destinations (build line, live listing) keyed by mod id. */
  modLinks,
  className,
}: {
  blocks: ActivityBlock[];
  /** Post title, for image alt fallbacks. */
  title: string;
  modLinks?: Record<string, ModLink>;
  className?: string;
}) {
  if (blocks.length === 0) return null;
  return (
    <div className={className ?? "grid gap-6"}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case "text":
            return block.style === "heading" ? (
              <h2 key={index} className="text-base font-[600]">
                {block.text}
              </h2>
            ) : (
              <p key={index} className="max-w-[62ch] whitespace-pre-line text-body leading-7">
                {block.text}
              </p>
            );
          case "images":
            return (
              <div
                key={index}
                className={`grid gap-3 ${block.urls.length > 1 ? "grid-cols-1 sm:grid-cols-2" : ""}`}
              >
                {block.urls.map((url, i) => (
                  <Media
                    key={i}
                    src={url}
                    alt={`${title} photo ${i + 1}`}
                    className={`${block.urls.length > 1 ? "h-44" : "h-64"} w-full rounded-ctl`}
                    role="feature"
                  />
                ))}
              </div>
            );
          case "embed":
            return (
              // Click to load: an iframe would contact YouTube on view,
              // before the visitor has chosen to (ConsentVideo).
              <ConsentVideo key={index} videoId={block.videoId} title={title} />
            );
          case "divider":
            return (
              <div key={index} className="is-in" aria-hidden="true">
                <div className="dimline-h" />
              </div>
            );
          case "mod": {
            const action = MOD_ACTIONS.find((a) => a.value === block.action)?.label ?? "Installed";
            const link = block.modItemId ? modLinks?.[block.modItemId] : undefined;
            return (
              <div key={index} className="modline">
                <span
                  className={
                    block.action === "removed" ? "chip chip--spent" : "chip chip--ok"
                  }
                >
                  {action}
                </span>
                <span className="modline__label">{block.label}</span>
                {block.detail && <span className="modline__detail">{block.detail}</span>}
                {link && (
                  <Link href={link.href} className="jumplink modline__link">
                    {link.label}
                  </Link>
                )}
              </div>
            );
          }
          case "before_after":
            return (
              <BeforeAfter
                key={index}
                beforeUrl={block.beforeUrl}
                afterUrl={block.afterUrl}
                beforeLabel={block.beforeLabel}
                afterLabel={block.afterLabel}
              />
            );
          case "performance": {
            const kind = PERFORMANCE_KINDS.find((k) => k.value === block.kind)?.label ?? "Result";
            return (
              <div key={index} className="perfcard">
                <div className="perfcard__head">
                  <span className="microlabel !mb-0">{kind}</span>
                  <span className="microlabel !mb-0 text-dim">Owner-reported</span>
                </div>
                <dl className="perfcard__grid">
                  {block.entries.map((entry, i) => (
                    <div key={i} className="perfcard__cell">
                      <dt className="microlabel !mb-0">{entry.label}</dt>
                      <dd className="perfcard__value">{entry.value}</dd>
                    </div>
                  ))}
                </dl>
                {block.note && <p className="perfcard__note">{block.note}</p>}
              </div>
            );
          }
          case "mileage":
            return (
              <p key={index} className="milestone">
                <span className="milestone__value">{block.value.toLocaleString()}</span>
                <span className="microlabel !mb-0">{block.unit === "km" ? "km" : "mi"} on the clock</span>
              </p>
            );
        }
      })}
    </div>
  );
}
