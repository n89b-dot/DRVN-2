/** The answer to "did this edit request commit?" (`checkListingEdit`). */
export type EditCheck =
  | { outcome: "saved"; version: string }
  | { outcome: "not_found" | "unavailable" };

/**
 * What the form's earlier saves — sent, never answered, then replaced by a
 * changed draft — came to:
 *  - `saved`: one committed. `version` is the listing version it produced,
 *    which the next save must expect. Every such save started from the same
 *    version, so at most one can have committed.
 *  - `none`: the server has no record of any. Not proof one can't still
 *    land — unless the listing has since been found changed (a conflict), in
 *    which case none of them ever can.
 *  - `unknown`: at least one couldn't be checked, and none is known saved.
 */
export type EarlierEdits =
  | { outcome: "saved"; version: string }
  | { outcome: "none" }
  | { outcome: "unknown" };

/** Asks, read-only, about each earlier request until one turns out saved. */
export async function settleEarlierEdits(
  requestIds: readonly string[],
  check: (requestId: string) => Promise<EditCheck>,
): Promise<EarlierEdits> {
  let unknown = false;
  for (const requestId of requestIds) {
    const answer = await check(requestId);
    if (answer.outcome === "saved") return { outcome: "saved", version: answer.version };
    if (answer.outcome === "unavailable") unknown = true;
  }
  return unknown ? { outcome: "unknown" } : { outcome: "none" };
}

/**
 * Identifies a draft: the same fields against the same listing version are
 * the same edit and keep their request id. The request id itself is left out.
 */
export function editFingerprint(formData: FormData): string {
  return JSON.stringify(
    [...formData.entries()]
      .filter(([key]) => key !== "request_id")
      .map(([key, value]) => [key, String(value)]),
  );
}
