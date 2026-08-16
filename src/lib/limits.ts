/**
 * Field length limits shared by server validation and client counters.
 * "use server" modules can only export async functions, so these live here —
 * a CountedField's `max` and its action's check must come from the same
 * constant or they drift (a counter promising 160 while the server allows
 * anything is theater; the reverse silently rejects valid input).
 */
export const ACTIVITY_TITLE_MAX = 160;
export const DISPLAY_NAME_MAX = 80;
