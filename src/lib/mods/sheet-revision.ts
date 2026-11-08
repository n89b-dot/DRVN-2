/**
 * What a member reads when the build sheet they loaded is no longer the
 * current one (N65, OS-W23): save_mod_items refuses a save over any other
 * revision. Kept out of the "use server" actions module, which may export
 * only async functions.
 */
export const STALE_MOD_SHEET =
  "This build changed since you opened it — in another tab or from your agent. Reload to see the latest; your edits here stay until you do.";
