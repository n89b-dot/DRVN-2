/**
 * Loading skeletons using the `.ghostrow` / `.gbar` / `.gbox` language that
 * shipped in the Livesheet stylesheet and had no call site — every route
 * previously blocked on 3–8 sequential queries with no feedback at all.
 */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="is-loading" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ghostrow">
          <span className="gbox" />
          <span className="stack">
            <span className="gbar" />
            <span className="gbar gbar--sm" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Ghost of a market card — image plate plus title/price bars. */
function SkeletonCard() {
  return (
    <div className="tile" aria-hidden="true">
      <span className="gbox mb-3 block !h-auto !w-full aspect-[3/2] !rounded-ctl" />
      <span className="gbar !w-[70%]" />
      <span className="gbar mt-2 !w-[40%]" />
      <span className="gbar gbar--sm mt-2 !w-[55%]" />
    </div>
  );
}

/** Card-grid placeholder matching the `.mkt` 3→2→1 layout, so the page
 *  resolves without a layout jolt (the old list-row skeleton stood in for
 *  five differently-shaped routes). */
export function SkeletonCardGrid({ label = "Loading", cards = 6 }: { label?: string; cards?: number }) {
  return (
    <div className="wrap">
      <p role="status" aria-live="polite" className="sr-only">
        {label}…
      </p>
      <header className="pagehead is-loading" aria-hidden="true">
        <span className="microlabel">{label}…</span>
        <span className="gbar mt-3 !h-8 !w-[60%]" />
        <span className="gbar gbar--sm mt-3 !w-[40%]" />
      </header>
      <div className="mkt is-loading" aria-hidden="true">
        {Array.from({ length: cards }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}

/** Masonry placeholder matching `.feedcols` — varied plate heights. */
export function SkeletonMasonry({ label = "Loading", cards = 6 }: { label?: string; cards?: number }) {
  return (
    <div className="wrap">
      <p role="status" aria-live="polite" className="sr-only">
        {label}…
      </p>
      <header className="pagehead is-loading" aria-hidden="true">
        <span className="microlabel">{label}…</span>
        <span className="gbar mt-3 !h-8 !w-[50%]" />
      </header>
      <div className="feedcols is-loading" aria-hidden="true">
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="tile">
            <span
              className={`gbox mb-3 block !h-auto !w-full !rounded-ctl ${i % 3 === 1 ? "aspect-[4/3]" : "aspect-[3/2]"}`}
            />
            <span className="gbar !w-[65%]" />
            <span className="gbar gbar--sm mt-2 !w-[45%]" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Two-column PDP placeholder — media block left, purchase rail right,
 *  mirroring the `.pdp` desktop grid and stacking on mobile. */
export function SkeletonPdp() {
  return (
    <div className="wrap">
      <p role="status" aria-live="polite" className="sr-only">
        Loading listing…
      </p>
      <header className="pagehead is-loading" aria-hidden="true">
        <span className="microlabel">Loading…</span>
        <span className="gbar mt-3 !h-8 !w-[55%]" />
      </header>
      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr] is-loading" aria-hidden="true">
        <div>
          <span className="gbox block !h-auto !w-full aspect-[16/8.5] !rounded-r" />
          <span className="gbar mt-6 !w-[85%]" />
          <span className="gbar gbar--sm mt-2 !w-[70%]" />
          <span className="gbar gbar--sm mt-2 !w-[60%]" />
        </div>
        <div className="tile">
          <span className="gbar gbar--sm !w-[30%]" />
          <span className="gbar mt-3 !h-10 !w-[55%]" />
          <span className="gbar gbar--sm mt-3 !w-[65%]" />
          <span className="gbar mt-5 !h-11 !w-full !rounded-ctl" />
          <span className="gbar mt-2 !h-11 !w-full !rounded-ctl" />
        </div>
      </div>
    </div>
  );
}

/** Console placeholder — microlabel plus ledger-shaped ghost rows. */
export function SkeletonLedger({ rows = 6 }: { rows?: number }) {
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        Loading…
      </p>
      <header className="pagehead is-loading" aria-hidden="true">
        <span className="microlabel">Loading…</span>
        <span className="gbar mt-3 !h-7 !w-[35%]" />
      </header>
      <SkeletonRows rows={rows} />
    </>
  );
}

/** Page-level placeholder: a heading block plus rows. */
export function SkeletonPage({
  label = "Loading",
  rows = 5,
}: {
  label?: string;
  rows?: number;
}) {
  return (
    <div className="wrap">
      {/* One polite announcement rather than a stream of skeleton noise. */}
      <p role="status" aria-live="polite" className="sr-only">
        {label}…
      </p>
      <header className="pagehead is-loading" aria-hidden="true">
        <span className="microlabel">{label}…</span>
        <span className="gbar mt-3 !h-8 !w-[60%]" />
        <span className="gbar gbar--sm mt-3 !w-[40%]" />
      </header>
      <SkeletonRows rows={rows} />
    </div>
  );
}
