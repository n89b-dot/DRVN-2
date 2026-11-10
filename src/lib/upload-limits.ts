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
