"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** What the operator checks with the new member before confirming it (N136). */
function AwaitingConfirmation({ factorId, enrolledAt }: { factorId: string; enrolledAt?: string }) {
  return <div role="status" className="my-4">
    <p className="mb-2">Your authenticator is set up. Before the console opens, the operator who added you has to confirm it with you, by phone or in person.</p>
    <p className="mb-2">Read them this reference:</p>
    <p className="my-2 break-all"><code>{factorId}</code></p>
    {enrolledAt && <p className="text-micro text-dim">Set up {new Date(enrolledAt).toLocaleString()}</p>}
    <p className="mt-2">If you didn&apos;t set this one up, tell the operator: someone else has your password.</p>
  </div>;
}

export function AdminVerifyForm({ factorId, next = "/admin", awaitingConfirmation }: {
  factorId?: string;
  next?: string;
  /** A promoted member the operator hasn't confirmed yet: once their factor
   *  is verified they are shown its reference instead of the console. */
  awaitingConfirmation?: { factorId?: string; enrolledAt?: string };
}) {
  const [factor, setFactor] = useState(factorId);
  const [enrollment, setEnrollment] = useState<{ qr_code: string; secret: string }>();
  const [confirmed, setConfirmed] = useState<{ factorId: string; enrolledAt?: string } | undefined>(
    awaitingConfirmation?.factorId ? { factorId: awaitingConfirmation.factorId, enrolledAt: awaitingConfirmation.enrolledAt } : undefined
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function enroll() {
    setBusy(true); setError("");
    try {
      const auth = createClient().auth;
      const { data: factors, error: listError } = await auth.mfa.listFactors();
      if (listError) throw listError;
      for (const existing of factors.all.filter((f) => f.factor_type === "totp" && f.status === "unverified")) {
        const result = await auth.mfa.unenroll({ factorId: existing.id }); if (result.error) throw result.error;
      }
      const { data, error } = await auth.mfa.enroll({ factorType: "totp", friendlyName: "DRVN admin" });
      if (error) throw error;
      setFactor(data.id); setEnrollment(data.totp);
    } catch { setError("Authenticator setup failed. Please retry."); }
    finally { setBusy(false); }
  }
  async function verify(form: FormData) {
    if (!factor) return;
    setBusy(true); setError("");
    try {
      const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId: factor, code: String(form.get("code") || "").trim() });
      if (error) throw error;
      if (awaitingConfirmation) {
        setEnrollment(undefined);
        setConfirmed({ factorId: factor, enrolledAt: new Date().toISOString() });
        return;
      }
      window.location.assign(next);
    } catch { setError("The code was not accepted. Try the current code from your authenticator."); }
    finally { setBusy(false); }
  }
  if (confirmed) return <AwaitingConfirmation factorId={confirmed.factorId} enrolledAt={confirmed.enrolledAt} />;
  return <>
    {!factor && <button className="relbtn" disabled={busy} onClick={enroll}>Set up authenticator</button>}
    {enrollment && <div className="my-4">
      {/* The auth service returns a data URL, displayed only during enrollment. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={enrollment.qr_code} width={220} height={220} alt="Scan with your authenticator app" />
      <p className="my-2 break-all">Manual setup key: <code>{enrollment.secret}</code></p>
      <p>Save this key in your password manager for recovery.</p>
    </div>}
    {factor && <form action={verify}><label className="block">Authenticator code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required className="ctl my-3 block" /></label><button className="relbtn" disabled={busy}>Verify</button></form>}
    {error && <p role="alert" className="field__err mt-3">{error}</p>}
  </>;
}
