import type { Instrumentation } from "next";

import { captureException, reportError } from "@/lib/monitoring";

/**
 * Startup gate: a production deploy with broken payments configuration must
 * fail at boot, not at the first checkout. validatePaymentsEnv throws on the
 * fatal shapes (stub-in-production without the explicit override, stripe mode
 * without its keys, live money without monitoring) and surfaces the softer
 * gaps as warnings.
 */
export async function register() {
  const { deployEnvProblem } = await import("@/lib/deployment");
  const deployProblem = deployEnvProblem();
  if (deployProblem) throw new Error(deployProblem); // #121: an unnamed hosted deployment fails loudly
  const { validatePaymentsEnv } = await import("@/lib/env");
  const { warnings } = validatePaymentsEnv(); // throws → the deploy fails loudly
  for (const warning of warnings) reportError(`[startup] ${warning}`);
}

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
