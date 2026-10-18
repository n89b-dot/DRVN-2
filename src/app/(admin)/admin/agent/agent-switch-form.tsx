"use client";

import { useRef, useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";

import { Button, Select, TextField } from "@/components/ui";

import { setAgentControl, type AgentControlState } from "./actions";
import { AGENT_SWITCH_SCOPES, type AgentSwitchScope } from "./switches";

/**
 * One switch's form: a global switch toggles in place; "add" picks a targeted
 * scope and an id. Every change needs a reason for the audit log.
 */
export function AgentSwitchForm({ scope, subject, on, add = false }: { scope?: AgentSwitchScope; subject?: string; on: boolean; add?: boolean }) {
  const [state, setState] = useState<AgentControlState>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const router = useRouter();
  // A transition, so a redirect the action already followed (MFA step-up)
  // lands in Next's redirect boundary instead of a second navigation.
  const [, startTransition] = useTransition();
  const idBase = `agent-switch-${add ? "add" : `${scope}-${subject ?? "all"}`}`;

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (submitting.current) return;
        const data = new FormData(event.currentTarget);
        submitting.current = true;
        setPending(true);
        setState(null);
        startTransition(async () => {
          try {
            const result = await setAgentControl(null, data);
            setState(result);
            if (result?.ok) {
              router.refresh();
              if (add) (event.target as HTMLFormElement).reset();
            }
          } catch (error) {
            unstable_rethrow(error);
            setState({ error: "Couldn't confirm the switch changed. Reload to see its current state." });
            router.refresh();
          } finally {
            submitting.current = false;
            setPending(false);
          }
        });
      }}
    >
      <input type="hidden" name="on" value={String(on)} />
      {add ? (
        <>
          <Select id={`${idBase}-scope`} name="scope" label="Pause" defaultValue="member" disabled={pending}>
            {AGENT_SWITCH_SCOPES.filter((item) => !["all", "buyer", "seller"].includes(item.scope)).map((item) => (
              <option key={item.scope} value={item.scope}>{item.label}</option>
            ))}
          </Select>
          <TextField id={`${idBase}-subject`} name="subject" label="Id" hint="The member, mandate or listing id." required disabled={pending} autoComplete="off" />
        </>
      ) : (
        <>
          <input type="hidden" name="scope" value={scope} />
          {subject && <input type="hidden" name="subject" value={subject} />}
        </>
      )}
      <TextField id={`${idBase}-reason`} name="reason" label="Reason" hint="Goes in the audit log." required maxLength={1000} disabled={pending} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant={on ? "destructive" : "default"} loading={pending} pendingLabel={on ? "Pausing…" : "Lifting…"}>
          {on ? "Pause" : "Lift"}
        </Button>
        {state?.error && <span className="field__err" role="alert">{state.error}</span>}
        {state?.ok && <span className="field__ok !block" role="status">{state.ok}</span>}
      </div>
    </form>
  );
}
