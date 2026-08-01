import type { DisputeCategory } from "@/lib/database.types";

/** The reasons a buyer can open a dispute with. Lives outside actions.ts
 *  because a "use server" file may only export async functions. */
export const DISPUTE_CATEGORIES: { value: DisputeCategory; label: string }[] = [
  { value: "item_not_received", label: "Item never arrived" },
  { value: "item_not_as_described", label: "Not as described" },
  { value: "damaged_in_transit", label: "Arrived damaged" },
  { value: "wrong_item", label: "Wrong item" },
  { value: "other", label: "Something else" },
];
