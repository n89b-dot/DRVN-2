import { reportError } from "@/lib/monitoring";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

function failureDetail(error: unknown): string | null {
  if (error == null) return null;
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 300);
  return String(error).slice(0, 300);
}

/**
 * Records one failed delivery of a provider event that is still unprocessed
 * (webhook_events.failed_attempts, 20261107170000), so an event the provider
 * keeps redelivering has an age, an attempt count and the last reason where
 * health and the payments console can see them (N109). `retry` = a handler
 * asked for redelivery; `error` = a handler threw.
 *
 * Never throws: the caller is already answering the provider with a 5xx, and
 * the event stays unprocessed (and so in the health backlog) either way.
 * Replaying is safe whatever this records — every handler is idempotent and
 * only a confirmed processed_at acknowledges an event.
 */
export async function recordWebhookFailure(
  admin: Admin,
  eventId: string,
  kind: "retry" | "error",
  context: { provider: "stripe" | "easypost"; type: string; error?: unknown },
): Promise<number | null> {
  let attempts: number | null = null;
  try {
    const { data, error } = await admin.rpc("record_webhook_failure", {
      p_id: eventId,
      p_kind: kind,
      p_detail: kind === "retry" ? "handler asked for redelivery" : failureDetail(context.error) ?? undefined,
    });
    if (error) reportError(`[${context.provider}:webhook] failed delivery could not be recorded`, { eventId, kind, error });
    else attempts = typeof data === "number" ? data : null;
  } catch (error) {
    reportError(`[${context.provider}:webhook] failed delivery could not be recorded`, { eventId, kind, error });
  }
  // A thrown handler is already reported by the route; a retry outcome was
  // silent before (N109), so it is reported here with its attempt count.
  if (kind === "retry") {
    reportError(`[${context.provider}:webhook] event left for redelivery`, { eventId, type: context.type, attempts });
  }
  return attempts;
}
