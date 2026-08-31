import "server-only";

import { easypostProvider } from "./easypost";
import { stubShippingProvider } from "./stub";
import type { ShippingProvider } from "./types";

/**
 * Shipping provider seam (brief §8/§42) — the one place the rest of the app
 * asks "can DRVN Shipping run, and through what".
 *
 * Mode resolution mirrors resolvePaymentsMode's rules, with one deliberate
 * difference: shipping fails DISABLED, not closed. Payments without a
 * provider is a broken marketplace; shipping without one just means sellers
 * use seller-arranged shipping (the required fallback, §42) — so a missing
 * EasyPost key in production quietly disables DRVN Shipping instead of
 * blocking a deploy.
 *
 * Rollout gate: FLAG_INTEGRATED_SHIPPING_V1 must be "true" for any mode but
 * disabled. The flag off = the feature does not exist anywhere in the UI.
 */

export type ShippingMode = "easypost" | "stub" | "disabled";

export class ShippingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShippingConfigError";
  }
}

type EnvLike = Record<string, string | undefined>;

/**
 * Pure over `env` for unit tests.
 *  - Flag off → disabled, always.
 *  - SHIPPING_MODE=easypost with no EASYPOST_API_KEY → throw (explicit ask,
 *    impossible config).
 *  - SHIPPING_MODE=stub in production → throw unless
 *    SHIPPING_ALLOW_STUB_IN_PRODUCTION=true (sandbox deploys only — a live
 *    marketplace printing fake labels is worse than no labels).
 *  - Unset: key present → easypost; absent in production → disabled (sellers
 *    fall back to seller-arranged shipping); absent elsewhere → stub.
 */
export function resolveShippingMode(env: EnvLike = process.env): ShippingMode {
  if (env.FLAG_INTEGRATED_SHIPPING_V1 !== "true") return "disabled";

  const explicit = env.SHIPPING_MODE;
  const production = env.NODE_ENV === "production";
  const hasKey = Boolean(env.EASYPOST_API_KEY);

  if (explicit && explicit !== "easypost" && explicit !== "stub" && explicit !== "disabled") {
    throw new ShippingConfigError(
      `SHIPPING_MODE must be "easypost", "stub" or "disabled", got "${explicit}".`
    );
  }
  if (explicit === "disabled") return "disabled";
  if (explicit === "easypost" || (!explicit && hasKey)) {
    if (!hasKey) {
      throw new ShippingConfigError(
        "SHIPPING_MODE=easypost but EASYPOST_API_KEY is not set. Set the key, or unset SHIPPING_MODE."
      );
    }
    return "easypost";
  }
  if (production && env.SHIPPING_ALLOW_STUB_IN_PRODUCTION !== "true") {
    if (explicit === "stub") {
      throw new ShippingConfigError(
        "SHIPPING_MODE=stub is refused in production. Set SHIPPING_ALLOW_STUB_IN_PRODUCTION=true only for a non-public sandbox deployment."
      );
    }
    return "disabled";
  }
  return "stub";
}

/** True when listings may offer DRVN Shipping and checkout may rate through it. */
export function integratedShippingEnabled(): boolean {
  return resolveShippingMode() !== "disabled";
}

export function getShippingProvider(): ShippingProvider {
  const mode = resolveShippingMode();
  if (mode === "easypost") return easypostProvider;
  if (mode === "stub") return stubShippingProvider;
  throw new ShippingConfigError(
    "DRVN Shipping is disabled (FLAG_INTEGRATED_SHIPPING_V1 unset, or no provider in production). Callers must check integratedShippingEnabled() first."
  );
}
