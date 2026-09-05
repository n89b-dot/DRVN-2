"use client";

import { useActionState } from "react";

import { Alert, Button, TextField } from "@/components/ui";

import { createBetaInvitation, type InvitationActionState } from "./actions";

export function InvitationForm({ siteOrigin }: { siteOrigin: string }) {
  const [state, action, pending] = useActionState<InvitationActionState, FormData>(
    createBetaInvitation,
    null
  );
  const link = state?.invitePath ? `${siteOrigin}${state.invitePath}` : null;

  return (
    <form action={action} className="tile tile--deep grid gap-4">
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
        required
      />
      <div className="field">
        <label htmlFor="invitation-days" className="microlabel">Expires in</label>
        <select id="invitation-days" name="days" className="ctl" defaultValue="14">
          <option value="1">1 day</option>
          <option value="7">7 days</option>
          <option value="14">14 days</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
        </select>
      </div>
      <fieldset className="field">
        <legend className="microlabel">Allowed commerce</legend>
        <label className="mt-2 flex items-center gap-2"><input name="buyer" type="checkbox" defaultChecked /> Buy</label>
        <label className="mt-2 flex items-center gap-2"><input name="seller" type="checkbox" defaultChecked /> Sell</label>
      </fieldset>
      {state?.error && <p className="field__error">{state.error}</p>}
      {state?.ok && <p className="field__ok">{state.ok}</p>}
      {link && (
        <Alert role="status" title="One-time invitation link"><span className="break-all font-mono text-sm">{link}</span></Alert>
      )}
      <Button type="submit" variant="live" disabled={pending}>
        {pending ? "Creating…" : "Create invitation"}
      </Button>
    </form>
  );
}

