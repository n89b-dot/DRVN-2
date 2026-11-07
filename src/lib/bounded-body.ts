/**
 * Read a request body up to `maxBytes`, counting bytes as they arrive — a
 * chunked request carries no Content-Length to check first. Returns `null`
 * when the body is larger than the limit (the stream is cancelled) and an
 * empty string when there is no body.
 */
export async function readBoundedBody(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get("content-length")) > maxBytes) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
