"use client";

import { useEffect, useState } from "react";

import { Toast } from "@/components/ui";

const EVENT = "drvn:admin-action-success";

export function announceAdminAction(message: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: message }));
}

export function AdminActionToast() {
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(null);

  useEffect(() => {
    function announce(event: Event) {
      const message = (event as CustomEvent<string>).detail;
      if (message) setNotice({ id: Date.now(), message });
    }
    window.addEventListener(EVENT, announce);
    return () => window.removeEventListener(EVENT, announce);
  }, []);

  return notice ? (
    <Toast key={notice.id} message={notice.message} onDone={() => setNotice(null)} />
  ) : null;
}
