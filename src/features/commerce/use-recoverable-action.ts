"use client";

import { useRef, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";

type ActionResult = { error?: string; ok?: string };

/** Keep a mutation form mounted when a Server Action response is lost.
 * Uncontrolled fields retain their values, and retrying sends the same input.
 *
 * The call runs inside a transition, like a form action. When the action
 * redirects, the router has already followed it, and the error it rejects
 * with then lands in Next's redirect boundary, which knows it was handled.
 * From a plain event handler the same error escaped as an unhandled
 * rejection, and Next followed the redirect a second time while the first
 * navigation was still in flight — on Next 16.2 that left the page stuck. */
export function useRecoverableAction<T extends ActionResult>(
  action: (previous: T, data: FormData) => Promise<T>,
  failure = "Couldn't confirm the update. Your details are still here; retry to check the saved result.",
) {
  const [state, setState] = useState<T>({} as T);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [, startTransition] = useTransition();

  function submit(data: FormData) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setState({} as T);
    startTransition(async () => {
      try {
        setState(await action({} as T, data));
      } catch (error) {
        unstable_rethrow(error);
        setState({ error: failure } as T);
      } finally {
        submitting.current = false;
        setPending(false);
      }
    });
  }

  return [state, submit, pending] as const;
}
