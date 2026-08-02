import type { OrderStatus } from "@/lib/database.types";

/**
 * Exception-first status encoding: a chip is an interrupt, so only the states
 * that need a human keep one — red when money or an order is stuck, amber when
 * something is mid-flight and fragile. Nominal and terminal states render as
 * plain dim text (`.status-plain`) instead, so a routine page carries no
 * colour and the one exceptional row is the only thing that pops.
 */
export const ORDER_STATUS_CHIP: Partial<Record<OrderStatus, string>> = {
  requires_action: "chip--warn",
  payment_failed: "chip--live",
  disputed: "chip--live",
};
