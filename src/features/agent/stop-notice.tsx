"use client";

import { createContext, useContext, useState } from "react";

import { ResultNote } from "@/components/ui";

/**
 * Where /agent keeps "Stopped." after "Stop negotiating for me".
 *
 * The stop revalidates /agent, so its Server Action response carries the
 * page with the mandate already revoked beside the result. On that page the
 * row that held the control has moved (Working → Done once its task is
 * cancelled), or gone (its Needs you approval is dismissed, or it was the
 * mandate's own row). No StopBuyerAgent survives that, so the result can't
 * stay on the control the way the offer page keeps it (`live`). Instead
 * every StopBuyerAgent under this hands its result up here, a slot that
 * stays mounted above the lists, and "Stopped." shows whichever commit
 * lands first.
 */
const StopNoticeContext = createContext<((ok: string) => void) | null>(null);

/** The slot StopBuyerAgent reports to, when it sits under StopNotices. */
export function useStopNotice() {
  return useContext(StopNoticeContext);
}

export function StopNotices({ children }: { children: React.ReactNode }) {
  const [note, setNote] = useState<string | null>(null);
  return (
    <StopNoticeContext.Provider value={setNote}>
      <ResultNote ok={note} className="mb-4" />
      {children}
    </StopNoticeContext.Provider>
  );
}
