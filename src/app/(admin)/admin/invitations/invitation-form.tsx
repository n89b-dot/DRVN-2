"use client";

import { useRef, useState } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";

import { Alert, Button, TextField } from "@/components/ui";

import { createBetaInvitation, type InvitationActionState } from "./actions";

function CopyInvitationLink({ link }: { link: string }) {
  const [result, setResult] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setResult("copied");
    } catch {
      setResult("failed");
    }
  }

  return (
    <>
      <Alert role="status" title="One-time invitation link">
        <span className="break-all font-mono text-sm">{link}</span>
      </Alert>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="quiet" onClick={copy}>
          {result === "copied" ? "Copied ✓" : "Copy invitation link"}
        </Button>
        {result === "copied" && <span className="field__ok !block" role="status">Invitation link copied.</span>}
        {result === "failed" && <span className="field__err" role="alert">Copy failed. Select the link above and copy it manually.</span>}
      </div>
    </>
  );
}

export function InvitationForm({ siteOrigin }: { siteOrigin: string }) {
  const [state, setState] = useState<InvitationActionState>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const router = useRouter();
  const link = state?.invitePath ? `${siteOrigin}${state.invitePath}` : null;

  return (
    <form className="tile tile--deep grid gap-4" onSubmit={async (event) => {
      event.preventDefault();
      if (submitting.current) return;
      const data = new FormData(event.currentTarget);
      submitting.current = true;
      setPending(true);
      setState(null);
      try {
        setState(await createBetaInvitation(null, data));
      } catch (error) {
        unstable_rethrow(error);
        setState({ error: "Couldn't confirm invitation creation. Check recent invitations before issuing another." });
        router.refresh();
      } finally {
        submitting.current = false;
        setPending(false);
      }
    }}>
      <div>
        <span className="microlabel microlabel--ink">Issue an invitation</span>
        <p className="order__meta mt-1">
          DRVN does not email this link. Copy it once and deliver it through the approved channel.
        </p>
      </div>
      <TextField
        id="invitation-email"
        name="email"
        type="email"
        label="Invited email"
        autoComplete="off"
        disabled={pending}
        required
      />
      <div className="field">
        <label htmlFor="invitation-days" className="microlabel">Expires in</label>
        <select id="invitation-days" name="days" disabled={pending} className="ctl" defaultValue="14">
          <option value="1">1 day</option>
          <option value="7">7 days</option>
          <option value="14">14 days</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
        </select>
      </div>
      <fieldset className="field" disabled={pending}>
        <legend className="microlabel">Allowed commerce</legend>
        <label className="mt-2 flex items-center gap-2"><input name="buyer" type="checkbox" defaultChecked /> Buy</label>
        <label className="mt-2 flex items-center gap-2"><input name="seller" type="checkbox" defaultChecked /> Sell</label>
      </fieldset>
      {state?.error && <p className="field__err" role="alert">{state.error}</p>}
      {state?.ok && <p className="field__ok !block" role="status">{state.ok}</p>}
      {link && <CopyInvitationLink key={link} link={link} />}
      <Button type="submit" variant="live" disabled={pending}>
        {pending ? "Creating…" : "Create invitation"}
      </Button>
    </form>
  );
}
