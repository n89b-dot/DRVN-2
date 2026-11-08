/**
 * R-photos (OS-W08): ordinary agent chat sends the model no image at all.
 * The two photo jobs keep image access, and only through this explicit mode,
 * which the server validates on every send: "listing" is "List this part
 * from my photos" (draft_listing_from_photos), "update" is "Post an update"
 * (draft_car_update). A photo job also offers the model only its own photo
 * tool.
 */
export const PHOTO_JOBS = ["listing", "update"] as const;

export type PhotoJob = (typeof PHOTO_JOBS)[number];

/** The photo tool each job may use; no other photo tool is offered in it. */
export const PHOTO_JOB_TOOL: Record<PhotoJob, string> = {
  listing: "draft_listing_from_photos",
  update: "draft_car_update",
};

export const PHOTO_TOOLS: ReadonlySet<string> = new Set(Object.values(PHOTO_JOB_TOOL));

export function parsePhotoJob(value: unknown): PhotoJob | null {
  return typeof value === "string" && (PHOTO_JOBS as readonly string[]).includes(value) ? (value as PhotoJob) : null;
}

/** Whether a tool is offered to the model on this turn. */
export function photoToolAllowed(tool: string, job: PhotoJob | null | undefined): boolean {
  if (!PHOTO_TOOLS.has(tool)) return true;
  return Boolean(job && PHOTO_JOB_TOOL[job] === tool);
}
