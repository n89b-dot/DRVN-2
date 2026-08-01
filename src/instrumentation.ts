import type { Instrumentation } from "next";

import { captureException } from "@/lib/monitoring";

/**
 * Server-side error firehose (Rev D R2). Next calls this for every error the
 * server captures — rendering, route handlers (including the Stripe webhook),
 * server actions, proxy — so nothing thrown escapes unreported. Caught-and-
 * swallowed errors are covered separately by `reportError` at the catch sites.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  await captureException(err, {
    tags: { routeType: context.routeType, routePath: context.routePath },
    extra: { path: request.path, method: request.method },
  });
};
