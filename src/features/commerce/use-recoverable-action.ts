"use client";

import { useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";

type ActionResult = { error?: string; ok?: string };

/** Keep a mutation form mounted when a Server Action response is lost.
 * Uncontrolled fields retain their values, and retrying sends the same input. */
export function useRecoverableAction<T extends ActionResult>(
  action: (previous: T, data: FormData) => Promise<T>,
  failure = "Couldn't confirm the update. Your details are still here; retry to check the saved result.",
) {
  const [state, setState] = useState<T>({} as T);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  async function submit(data: FormData) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setState({} as T);
    try {
      setState(await action({} as T, data));
    } catch (error) {
      unstable_rethrow(error);
      setState({ error: failure } as T);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return [state, submit, pending] as const;
}
