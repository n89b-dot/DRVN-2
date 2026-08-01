/**
 * Error reporting to Sentry — without the SDK (Rev D R2).
 *
 * The official @sentry/nextjs SDK instruments builds and patches runtimes;
 * against this repo's Next version that is more surface area than the need
 * justifies. Sentry's ingest API is a stable HTTP contract (an "envelope":
 * newline-delimited JSON), so this module speaks it directly: zero
 * dependencies, no build integration, and a no-op when SENTRY_DSN is unset —
 * exactly like the rest of the codebase treats optional infrastructure.
 *
 * Entry points:
 *  - `captureException` / `captureMessage` — direct captures with tags/extra.
 *  - `reportError(...args)` — drop-in for `console.error` in server catch
 *    paths: logs identically, then forwards to Sentry. Server actions that
 *    swallow errors into `{ error }` returns stay observable through it.
 *  - `instrumentation.ts` wires `onRequestError`, which catches everything
 *    thrown: rendering, route handlers (the Stripe webhook), server actions.
 */

type Level = "fatal" | "error" | "warning" | "info";

type CaptureContext = {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
};

function dsnParts(): { endpoint: string; key: string } | null {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, "");
    if (!url.username || !projectId) return null;
    return {
      endpoint: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
      key: url.username,
    };
  } catch {
    return null;
  }
}

function eventId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function send(event: Record<string, unknown>): Promise<void> {
  const dsn = dsnParts();
  if (!dsn) return;

  const id = eventId();
  const now = new Date().toISOString();
  const envelope =
    JSON.stringify({ event_id: id, sent_at: now }) +
    "\n" +
    JSON.stringify({ type: "event" }) +
    "\n" +
    JSON.stringify({
      event_id: id,
      timestamp: now,
      platform: "javascript",
      environment: process.env.NODE_ENV ?? "development",
      server_name: "drvn",
      ...event,
    });

  try {
    await fetch(dsn.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=drvn/1.0, sentry_key=${dsn.key}`,
      },
      body: envelope,
    });
  } catch {
    // Monitoring must never take the product down with it.
  }
}

export async function captureException(
  error: unknown,
  context: CaptureContext = {}
): Promise<void> {
  const err = error instanceof Error ? error : new Error(String(error));
  await send({
    level: "error",
    exception: {
      values: [
        {
          type: err.name,
          value: err.message,
          ...(err.stack ? { stacktrace: { frames: parseStack(err.stack) } } : {}),
        },
      ],
    },
    tags: context.tags,
    extra: context.extra,
  });
}

export async function captureMessage(
  message: string,
  level: Level = "info",
  context: CaptureContext = {}
): Promise<void> {
  await send({ level, message: { formatted: message }, tags: context.tags, extra: context.extra });
}

/**
 * Drop-in for `console.error` in server catch paths: same signature, same
 * console output, plus a Sentry event. Fire-and-forget by design — catch
 * paths shouldn't slow down on telemetry.
 */
export function reportError(...args: unknown[]): void {
  console.error(...args);
  const [first, ...rest] = args;
  const errorArg = args.find((a) => a instanceof Error);
  const extra: Record<string, unknown> = {};
  rest.forEach((arg, i) => {
    if (arg !== errorArg) extra[`arg${i}`] = arg;
  });
  if (errorArg) {
    void captureException(errorArg, { extra: { message: String(first), ...extra } });
  } else {
    void captureMessage(String(first), "error", { extra });
  }
}

/** Sentry wants oldest-first frames; keep it approximate but useful. */
function parseStack(stack: string) {
  return stack
    .split("\n")
    .slice(1)
    .map((line) => {
      const match = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim());
      if (!match) return { function: line.trim() };
      return {
        function: match[1] ?? "<anonymous>",
        filename: match[2],
        lineno: Number(match[3]),
        colno: Number(match[4]),
      };
    })
    .reverse();
}
