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

/** Page-level placeholder: a heading block plus rows. */
export function SkeletonPage({
  label = "Drawing the sheet",
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
