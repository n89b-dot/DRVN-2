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
    if (url.protocol !== "https:" || !url.username || !/^\d+$/.test(projectId)) return null;
    return {
      endpoint: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
      key: url.username,
    };
  } catch {
    return null;
  }
}

/** Best-available release/deploy identity, host-agnostic. */
function releaseInfo(): Record<string, unknown> {
  const release =
    // `||`, not `??`: an empty value set by the host falls through (#120).
    process.env.SENTRY_RELEASE ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    undefined;
  const deployment = process.env.VERCEL_DEPLOYMENT_ID || process.env.DEPLOY_ID || undefined;
  return {
    ...(release ? { release } : {}),
    ...(deployment ? { tags: { deployment } } : {}),
  };
}

function eventId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * In-flight sends, so serverless paths can flush before the runtime freezes —
 * a webhook that reports an error and returns must not lose the report.
 */
const inFlight = new Map<Promise<void>, AbortController>();
const MAX_IN_FLIGHT = 32;
let deliveryFailureLogged = false;

async function send(event: Record<string, unknown>): Promise<void> {
  const dsn = dsnParts();
  if (!dsn || inFlight.size >= MAX_IN_FLIGHT) return;

  const id = eventId();
  const now = new Date().toISOString();
  const release = releaseInfo();
  const baseTags = (release.tags as Record<string, string> | undefined) ?? {};
  const eventTags = (event.tags as Record<string, string> | undefined) ?? {};
  const envelope =
    JSON.stringify({ event_id: id, sent_at: now }) +
    "\n" +
    JSON.stringify({ type: "event" }) +
    "\n" +
    JSON.stringify(scrubTelemetry({
      event_id: id,
      timestamp: now,
      platform: "javascript",
      environment: process.env.NODE_ENV ?? "development",
      server_name: "drvn",
      ...release,
      ...event,
      tags: { ...baseTags, ...eventTags },
    }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  const delivery = (async () => {
    try {
      const response = await fetch(dsn.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-sentry-envelope",
          "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=drvn/1.0, sentry_key=${dsn.key}`,
        },
        body: envelope,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Telemetry HTTP ${response.status}`);
    } catch (error) {
      // Monitoring must never take the product down with it — but a broken
      // DSN should not be indistinguishable from an absent one either.
      if (!deliveryFailureLogged) {
        deliveryFailureLogged = true;
        console.error("[monitoring] Sentry delivery failed (logged once)", error);
      }
    } finally {
      clearTimeout(timeout);
    }
  })();
  inFlight.set(delivery, controller);
  void delivery.finally(() => inFlight.delete(delivery));
  await delivery;
}

/** Await every pending report — call before returning from serverless paths. */
export async function flushMonitoring(budgetMs = 1000): Promise<void> {
  const pending = [...inFlight.entries()];
  if (!pending.length) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(pending.map(([promise]) => promise)),
    new Promise<void>((resolve) => { timer = setTimeout(() => {
      for (const [promise, controller] of pending) { controller.abort(); inFlight.delete(promise); }
      resolve();
    }, budgetMs); }),
  ]);
  clearTimeout(timer);
}

const MAX_DEPTH = 8;
const SENSITIVE_KEY = /password|secret|authorization|cookie|token|ship_|address|email|phone|payload/i;
/**
 * Error fields that carry a whole provider request or response rather than the
 * reason: Stripe's `raw` (a duplicate of every field, with full objects) and
 * response `headers`, a signature error's `header`, HTTP clients'
 * `request`/`response`/`config`. The reason survives in message, code and type.
 */
const DROPPED_ERROR_FIELDS = new Set(["raw", "headers", "header", "request", "response", "config"]);
/** Stripe errors embed whole objects (billing details, card) — keep only the id. */
const ID_ONLY_ERROR_FIELDS = new Set(["payment_intent", "payment_method", "setup_intent", "source"]);

/**
 * An Error's name, message and stack are not enumerable, so an error nested in
 * an object (`{ orderId, error }`) serialises to `{}`. Copy them out, with the
 * cause chain, AggregateError members and the error's own diagnostic fields
 * (code, details, hint, statusCode, decline_code…), minus provider payloads.
 */
function errorRecord(error: Error): Record<string, unknown> {
  const record: Record<string, unknown> = { name: error.name, message: error.message };
  if (error.stack) record.stack = error.stack;
  for (const [key, value] of Object.entries(error)) {
    if (key in record || DROPPED_ERROR_FIELDS.has(key)) continue;
    record[key] = ID_ONLY_ERROR_FIELDS.has(key) && value && typeof value === "object"
      ? (typeof (value as { id?: unknown }).id === "string" ? (value as { id: string }).id : "[object]")
      : value;
  }
  if (error.cause !== undefined) record.cause = error.cause;
  if (error instanceof AggregateError) record.errors = error.errors;
  return record;
}

/**
 * Redact known credentials and private fields before any remote serialization.
 * Errors are expanded at any depth; cycles and runaway depth are cut off.
 */
export function scrubTelemetry(value: unknown, depth = 0, ancestors: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === "string") return value
    .replace(/\b(?:sk|pk|rk|whsec|sb_secret)_[A-Za-z0-9_]+|\b(?:pi|seti)_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/([?&](?:token_hash|code|token|payment_intent_client_secret|setup_intent_client_secret)=)[^&\s]+/g, "$1[redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .slice(0, 4000);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "[invalid date]" : value.toISOString();
  if (!value || typeof value !== "object") return value;
  if (depth > MAX_DEPTH) return "[truncated]";
  if (ancestors.has(value)) return "[circular]";
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.slice(0, 30).map((v) => scrubTelemetry(v, depth + 1, ancestors));
    const source = value instanceof Error ? errorRecord(value) : value;
    return Object.fromEntries(Object.entries(source).map(([k, v]) =>
      [k, SENSITIVE_KEY.test(k) ? "[redacted]" : scrubTelemetry(v, depth + 1, ancestors)]));
  } finally {
    // Ancestors only: the same object referenced twice side by side is not a cycle.
    ancestors.delete(value);
  }
}

export async function captureException(
  error: unknown,
  context: CaptureContext = {}
): Promise<void> {
  const err = error instanceof Error ? error : new Error(nonErrorMessage(error));
  await send({
    level: "error",
    // Sentry lists chained exceptions innermost cause first, the caught one last.
    exception: { values: causeChain(err).reverse().map(exceptionValue) },
    tags: context.tags,
    extra: context.extra,
  });
}

const MAX_CAUSES = 5;

/** The error and its `cause` Errors, outermost first, cycle-safe and bounded. */
function causeChain(error: Error): Error[] {
  const chain: Error[] = [];
  let current: unknown = error;
  while (current instanceof Error && chain.length <= MAX_CAUSES && !chain.includes(current)) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

function exceptionValue(error: Error) {
  return {
    type: error.name,
    value: error.message,
    ...(error.stack ? { stacktrace: { frames: parseStack(error.stack) } } : {}),
  };
}

/** A thrown non-Error (a provider's plain `{ message, code }`) keeps its content. */
function nonErrorMessage(value: unknown): string {
  if (value && typeof value === "object") {
    try { return JSON.stringify(scrubTelemetry(value)).slice(0, 1000); } catch { /* fall through */ }
  }
  return String(value);
}

export async function captureMessage(
  message: string,
  level: Level = "info",
  context: CaptureContext = {}
): Promise<void> {
  await send({ level, message: { formatted: message }, tags: context.tags, extra: context.extra });
}

/**
 * The Error a report is about: one passed on its own, or one carried in a
 * context object (`{ orderId, error }`, `{ claimError }`) — the shape most
 * money-path catch blocks use.
 */
function reportedError(args: unknown[]): Error | undefined {
  const direct = args.find((a): a is Error => a instanceof Error);
  if (direct) return direct;
  for (const arg of args) {
    if (!arg || typeof arg !== "object" || Array.isArray(arg)) continue;
    const nested = Object.values(arg).find((v): v is Error => v instanceof Error);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * Drop-in for `console.error` in server catch paths: same signature, same
 * console output, plus a Sentry event. Fire-and-forget by design — catch
 * paths shouldn't slow down on telemetry. Errors at any depth of the context
 * keep their name, message, stack and cause in both the log and the event.
 */
export function reportError(...args: unknown[]): void {
  console.error(...args.map((arg) => scrubTelemetry(arg)));
  const [first, ...rest] = args;
  const errorArg = reportedError(args);
  const extra: Record<string, unknown> = {};
  rest.forEach((arg, i) => {
    if (arg !== errorArg) extra[`arg${i}`] = arg;
  });
  if (errorArg) {
    // The event title becomes the error's own message; the call-site label
    // stays searchable as a tag (Sentry caps tag values at 200 characters).
    void captureException(errorArg, {
      tags: { report: String(first).slice(0, 200) },
      extra: { message: String(first), ...extra },
    });
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
