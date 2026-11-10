/**
 * N1053 (work review #137): a member photo that reaches the browser still in
 * its canonical spelling was read without the signing wrapper, or while the
 * signer had no answer. The storage layer refuses that spelling, the page
 * draws the no-photo plate, and nothing fails: the plate hid the mistake.
 * This tells monitoring, through an intake of its own
 * (src/app/api/monitoring/photo), as a warning.
 *
 * What is sent is the photo's bucket and the first segment of the page's
 * path, nothing more (review of #244). Not the object: its path holds a
 * member's id. Not the page's path: /account-deletion/<reference> is a link
 * only its holder should have, and the sign-in pages' backdrop draws member
 * photos on that page. "account-deletion" says which page well enough.
 *
 * One report for each such area, at most three for each page load, so a grid
 * of forty unsigned photos is one report. The intake has a ceiling across all
 * visitors as well: an outage of the signer is not a flood.
 */

export const UNSIGNED_PHOTO_REPORTS_PER_LOAD = 3;

export type UnsignedPhotoReport = { bucket: string; area: string };

/**
 * The part of a page's path that is safe to send: its first segment, when it
 * is a plain word ("garage", "account-deletion"), "home" for the root, and
 * "other" for anything else (a first segment that could itself be an id).
 * Null for a page that must not report at all: the component docs show an
 * unsigned photo on purpose.
 */
export function photoReportArea(pathname: string): string | null {
  const first = pathname.split(/[?#]/)[0].split("/").filter(Boolean)[0] ?? "";
  if (first === "docs") return null;
  if (first === "") return "home";
  return /^[a-z][a-z-]{0,30}$/.test(first) ? first : "other";
}

export function createUnsignedPhotoReporter(deps: { path: () => string; send: (report: UnsignedPhotoReport) => void }): (src: string) => void {
  const reported = new Set<string>();
  return (src) => {
    const area = photoReportArea(deps.path());
    if (area === null || reported.has(area) || reported.size >= UNSIGNED_PHOTO_REPORTS_PER_LOAD) return;
    reported.add(area);
    const bucket = /\/storage\/v1\/object\/public\/([a-z0-9-]+)\//.exec(src)?.[1] ?? "unknown";
    deps.send({ bucket, area });
  };
}

/** The page's own reporter. Call it only in the browser (from an effect). */
export const reportUnsignedPhoto = createUnsignedPhotoReporter({
  path: () => window.location.pathname,
  send: (report) => {
    void fetch("/api/monitoring/photo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
      keepalive: true,
    }).catch(() => {});
  },
});
