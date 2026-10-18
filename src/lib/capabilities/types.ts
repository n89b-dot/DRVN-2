import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { riskAtMost, type AgentContext, type AgentScope, type Risk } from "@/lib/agent/context";
import type { Database } from "@/lib/database.types";

/**
 * Typed domain services (docs/decisions/agent-foundations.md §2). Each one
 * has a zod input and output, a risk level, the scopes it belongs to, and runs
 * with the member's own row-security client — never the service role. The
 * app's screens, a server action and (later) the agent call the same
 * capability, so a person and the agent take one path. The agent never calls
 * a server action.
 */

export type MemberClient = SupabaseClient<Database>;

export type CapabilityRun = { context: AgentContext; supabase: MemberClient };

export type Capability<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  risk: Risk;
  scopes: readonly AgentScope[];
  input: I;
  output: O;
  run(run: CapabilityRun, input: z.infer<I>): Promise<z.infer<O>>;
};

export function defineCapability<I extends z.ZodType, O extends z.ZodType>(capability: Capability<I, O>): Capability<I, O> {
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(capability.name)) throw new Error(`Bad capability name: ${capability.name}`);
  return capability;
}

export class CapabilityError extends Error {
  constructor(public readonly code: "invalid_input" | "invalid_output" | "not_allowed" | "failed", message: string, public readonly cause?: unknown) {
    super(message);
  }
}

/**
 * The one way to run a capability: the scope and risk are checked against the
 * context, the input is parsed, the output validated. A capability that
 * returns something off its contract fails rather than leaking it.
 */
export async function invokeCapability<I extends z.ZodType, O extends z.ZodType>(
  capability: Capability<I, O>,
  run: CapabilityRun,
  rawInput: unknown,
): Promise<z.infer<O>> {
  if (!capability.scopes.includes(run.context.scope)) {
    throw new CapabilityError("not_allowed", `${capability.name} is not available in the ${run.context.scope} scope`);
  }
  if (!riskAtMost(capability.risk, run.context.permissions.maxRisk)) {
    throw new CapabilityError("not_allowed", `${capability.name} needs ${capability.risk}; this context allows ${run.context.permissions.maxRisk}`);
  }
  const input = capability.input.safeParse(rawInput);
  if (!input.success) throw new CapabilityError("invalid_input", `${capability.name}: ${input.error.issues.map((issue) => issue.message).join("; ")}`);
  const result = await capability.run(run, input.data);
  const output = capability.output.safeParse(result);
  if (!output.success) throw new CapabilityError("invalid_output", `${capability.name} returned something off its contract`);
  return output.data;
}
