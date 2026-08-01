import { captureMessage } from "@/lib/monitoring";

/**
 * Client-side error intake (Rev D R2). The error boundaries POST here so
 * browser render failures reach Sentry without shipping the DSN (a server
 * secret) to the client. Payloads are size-capped and shape-checked; the
 * route always 204s — an error reporter that errors helps nobody.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      message?: unknown;
      stack?: unknown;
      digest?: unknown;
      path?: unknown;
    };
    const message = String(body.message ?? "client error").slice(0, 500);
    await captureMessage(message, "error", {
      tags: { source: "client-boundary" },
      extra: {
        stack: String(body.stack ?? "").slice(0, 4000),
        digest: String(body.digest ?? "").slice(0, 100),
        path: String(body.path ?? "").slice(0, 300),
      },
    });
  } catch {
    // Malformed report — drop it.
  }
  return new Response(null, { status: 204 });
}
