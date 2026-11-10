/**
 * N1053 (work review #137): a member photo that reaches the browser still in
 * its canonical spelling was read without the signing wrapper, or while the
 * signer had no answer. The storage layer refuses that spelling, the page
 * draws the no-photo plate, and nothing fails: the plate hid the mistake.
 * This tells monitoring, through the same server relay the error boundaries
 * use (`/api/monitoring`, rate-limited per visitor).
 *
 * One report for each page address, at most three for each page load, so a
 * grid of forty unsigned photos is one report and an outage of the signer is
 * not a flood. The report names the bucket and the page, never the object:
 * its path holds a member's id.
 */

export const UNSIGNED_PHOTO_REPORTS_PER_LOAD = 3;

export type UnsignedPhotoReport = { message: string; path: string };

export function createUnsignedPhotoReporter(deps: { path: () => string; send: (report: UnsignedPhotoReport) => void }): (src: string) => void {
  const reported = new Set<string>();
  return (src) => {
    const path = deps.path();
    if (reported.has(path) || reported.size >= UNSIGNED_PHOTO_REPORTS_PER_LOAD) return;
    reported.add(path);
    const bucket = /\/storage\/v1\/object\/public\/([a-z0-9-]+)\//.exec(src)?.[1] ?? "unknown bucket";
    deps.send({ message: `A member photo reached a page unsigned (${bucket})`, path });
  };
}

/** The page's own reporter. Call it only in the browser (from an effect). */
export const reportUnsignedPhoto = createUnsignedPhotoReporter({
  path: () => window.location.pathname,
  send: (report) => {
    void fetch("/api/monitoring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
      keepalive: true,
    }).catch(() => {});
  },
});
