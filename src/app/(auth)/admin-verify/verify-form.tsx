"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
export function AdminVerifyForm({ factorId }: { factorId?: string }) {
  const [factor, setFactor] = useState(factorId);
  const [enrollment, setEnrollment] = useState<{ qr_code: string; secret: string }>();
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
      window.location.assign("/admin");
    } catch { setError("The code was not accepted. Try the current code from your authenticator."); }
    finally { setBusy(false); }
  }
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
