export type DeletionBlockers = { financial_hold?: boolean; retained_identity?: boolean };

export function deletionOutcome(blockers: DeletionBlockers) {
  if (blockers.financial_hold) return "temporary_financial_hold" as const;
  if (blockers.retained_identity) return "operator_attention" as const;
  return "hard_delete_eligible" as const;
}
