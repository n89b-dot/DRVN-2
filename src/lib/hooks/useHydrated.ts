"use client";

import { useSyncExternalStore } from "react";

const subscribeNever = () => () => {};

/**
 * `false` on the server and while the page hydrates, `true` once the
 * component is live.
 *
 * A server-rendered field that React controls (`value={state}` /
 * `checked={state}`) loses whatever was typed before hydration: React puts
 * the field back to its initial state when it takes over. Keep such fields
 * disabled until this flag is true — usually by wrapping the form's contents
 * in `<fieldset disabled={!ready} className="contents">`, which changes no
 * layout. Uncontrolled fields (`defaultValue`) do not need it.
 *
 * @returns whether hydration has finished for this component.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}
