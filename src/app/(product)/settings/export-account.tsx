"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";

type ExportRequest = { id: string; status: string; expires_at: string; last_error: string | null; download_url: string | null };

export function ExportAccount() {
  const [request, setRequest] = useState<ExportRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function refresh() {
    const response = await fetch("/api/account/export", { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json() as { request: ExportRequest | null };
    setRequest(body.request);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!request || !["pending", "processing"].includes(request.status)) return;
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [request]);
  async function start() {
    setPending(true); setError(null);
    try {
      const response = await fetch("/api/account/export", { method: "POST" });
      const body = await response.json() as { id?: string; status?: string; error?: string };
      if (!response.ok || !body.id) throw new Error(body.error ?? "Your export could not be queued.");
      setRequest({ id: body.id, status: body.status ?? "pending", expires_at: "", last_error: null, download_url: null });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your export could not be queued."); }
    finally { setPending(false); }
  }
  if (request?.status === "completed" && request.download_url) return <a href={request.download_url} download className="btn btn--ghost">Download export package</a>;
  return <div>
    <Button type="button" variant="ghost" loading={pending} pendingLabel="Requesting…" onClick={start} disabled={request?.status === "pending" || request?.status === "processing"}>
      {request?.status === "pending" || request?.status === "processing" ? "Preparing export…" : "Request my data"}
    </Button>
    {(request?.status === "pending" || request?.status === "processing") && <p className="field__hint mt-2">This usually takes a few minutes. You can leave this page — the download appears here when it&apos;s ready.</p>}
    {request?.status === "failed" && <p role="alert" className="field__err mt-2">The export stopped before completion. Request a new package or contact support.</p>}
    {request?.status === "expired" && <p className="field__hint mt-2">That private package expired. You can request a fresh one.</p>}
    {error && <p role="alert" className="field__err mt-2">{error}</p>}
  </div>;
}
