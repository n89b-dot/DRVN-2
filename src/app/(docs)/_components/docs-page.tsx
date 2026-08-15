import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared furniture for docs pages. Every page head carries a link to its
 * markdown twin so the agent-readable version is always one click away.
 */
export function DocsPagehead({
  index,
  liveWord,
  titleRest,
  mdSlug,
  sub,
}: {
  index: string;
  /** The one live word in the h1. */
  liveWord: string;
  /** The rest of the h1 after the live word. */
  titleRest?: string;
  mdSlug: string;
  sub: string;
}) {
  return (
    // .is-in renders the live-word underline settled — docs pages don't run
    // the reveal observer.
    <div className="pagehead is-in">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="microlabel">Sheet {index} — DRVN docs</span>
        <Link className="jumplink" href={`/docs/md/${mdSlug}`}>
          View as markdown ↗
        </Link>
      </div>
      <h1>
        <span className="live-word">{liveWord}</span>
        {titleRest ? <> {titleRest}</> : null}
      </h1>
      <p className="sub">{sub}</p>
    </div>
  );
}

/**
 * A drawn-in horizontal dimension line. `.dimline-h` scales from 0 until an
 * ancestor carries `.is-in` (normally added by the reveal observer); docs
 * pages render settled, so the wrapper supplies it.
 */
export function Rule({ className = "" }: { className?: string }) {
  return (
    <div className={`is-in ${className}`} aria-hidden="true">
      <div className="dimline-h" />
    </div>
  );
}

/** Anchor row for long pages — the jumprow idiom, not tabs. */
export function DocsJumprow({ items }: { items: { href: string; label: string }[] }) {
  return (
    <nav className="jumprow" aria-label="On this sheet">
      <span className="microlabel">On this sheet</span>
      {items.map((item) => (
        <a key={item.href} className="jumplink" href={item.href}>
          {item.label}
        </a>
      ))}
    </nav>
  );
}

/** A labeled component specimen: name, class reference, live demo, note. */
export function Specimen({
  name,
  klass,
  note,
  deep = false,
  children,
}: {
  name: string;
  klass?: string;
  note?: string;
  /** Render the demo area on the deeper tile tone (for tile-on-tile demos). */
  deep?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={deep ? "tile tile--deep" : "tile"}>
      <div className="tile__head">
        <span className="microlabel !mb-0">{name}</span>
        {klass ? <span className="kv">{klass}</span> : null}
      </div>
      <div className="specimen-body">{children}</div>
      {note ? <p className="mt-3 text-micro leading-relaxed text-dim">{note}</p> : null}
    </section>
  );
}

/** Section heading inside a docs page: anchored microlabel + rule. */
export function SpecimenGroup({
  id,
  index,
  title,
  children,
}: {
  id: string;
  index: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 pb-[clamp(32px,4vw,48px)]">
      <div className="mb-3 mt-8 flex items-baseline gap-3">
        <span className="microlabel microlabel--ink !mb-0">{index}</span>
        <h2 className="text-section font-[600] leading-[1.3] tracking-[-0.01em]">{title}</h2>
      </div>
      <Rule className="mb-4" />
      <div className="deck deck--two">{children}</div>
    </section>
  );
}
