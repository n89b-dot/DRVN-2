/**
 * The most a photo sent through /api/media/public-photo may weigh (#118,
 * N955). That route runs as a serverless function, and a serverless host
 * refuses request bodies above about 4.5 MB before the app sees them, so a
 * photo over 4 MB (plus the form around it) would fail with no words. The
 * browser shrinks a camera photo well under this (2560px, JPEG); only a file
 * it can't shrink can be over, and that is refused here with what to do.
 * Dispute evidence uploads straight to Storage and keeps its own limit.
 */
export const SERVER_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/** A profile photo's own, smaller ceiling, checked by the same route. */
export const AVATAR_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

/**
 * How the browser shrinks a photo before sending it, by bucket (work review
 * #158, N1074). A profile photo is shown small and capped at 2 MB, so it is
 * cut to a 1024px long edge and aimed well under that cap; a camera photo
 * chosen as an avatar used to be refused outright for being over 2 MB.
 * Everything else keeps the general shrink (2560px, aimed under 3.5 MB).
 */
export const PHOTO_SHRINK = { maxEdge: 2560, targetBytes: 3_500_000 } as const;
export const AVATAR_SHRINK = { maxEdge: 1024, targetBytes: 1_500_000 } as const;
export const shrinkFor = (bucket: string): { maxEdge: number; targetBytes: number } => (bucket === "avatars" ? AVATAR_SHRINK : PHOTO_SHRINK);

/** The ceiling the photo route applies to a bucket. */
export const serverUploadMaxBytes = (bucket: string) => (bucket === "avatars" ? AVATAR_UPLOAD_MAX_BYTES : SERVER_UPLOAD_MAX_BYTES);
