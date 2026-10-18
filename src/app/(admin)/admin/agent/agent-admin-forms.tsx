"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";

import { Button, Message, MessageThread, Select, TextField } from "@/components/ui";

import { openAgentChat, type AgentChatState, type AgentControlState } from "./actions";

/**
 * One audited admin change on the agent page: hidden inputs, any fields,
 * a reason, and a submit. Runs in a transition so a step-up redirect lands
 * in Next's boundary, then refreshes the page to show the new state.
 */
export function AgentActionForm({
  action,
  id,
  hidden,
  fields,
  submitLabel,
  pendingLabel,
  destructive = false,
}: {
  action: (previous: AgentControlState, data: FormData) => Promise<AgentControlState>;
  id: string;
  hidden: Record<string, string>;
  fields?: ReactNode;
  submitLabel: string;
  pendingLabel: string;
  destructive?: boolean;
}) {
  const [state, setState] = useState<AgentControlState>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const router = useRouter();
  const [, startTransition] = useTransition();

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
            const result = await action(null, data);
            setState(result);
            if (result?.ok) router.refresh();
          } catch (error) {
            unstable_rethrow(error);
            setState({ error: "Couldn't confirm the change. Reload to see the current state." });
          } finally {
            submitting.current = false;
            setPending(false);
          }
        });
      }}
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {fields}
      <TextField id={`${id}-reason`} name="reason" label="Reason" hint="Goes in the audit log." required maxLength={1000} disabled={pending} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant={destructive ? "destructive" : "default"} loading={pending} pendingLabel={pendingLabel}>
          {submitLabel}
        </Button>
        {state?.error && <span className="field__err" role="alert">{state.error}</span>}
        {state?.ok && <span className="field__ok !block" role="status">{state.ok}</span>}
      </div>
    </form>
  );
}

/**
 * Opening a member's agent chat: only for an abuse report or a dispute, with
 * the case named and a reason. The database audits the opening first.
 */
export function AgentChatGate({ member }: { member: string }) {
  const [state, setState] = useState<AgentChatState>(null);
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  if (state?.messages) {
    return state.messages.length ? (
      <MessageThread>
        {state.messages.map((message) => (
          <Message key={message.id} me={message.role === "member"} who={message.role === "member" ? "Member" : "Agent"} when={message.created_at} body={message.body} />
        ))}
      </MessageThread>
    ) : (
      <p className="order__meta">Opened and audited. This member has no agent chat.</p>
    );
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const data = new FormData(event.currentTarget);
        setPending(true);
        startTransition(async () => {
          try {
            setState(await openAgentChat(null, data));
          } catch (error) {
            unstable_rethrow(error);
            setState({ error: "Couldn't open the chat." });
          } finally {
            setPending(false);
          }
        });
      }}
    >
      <input type="hidden" name="member" value={member} />
      <Select id="agent-chat-case-kind" name="case_kind" label="For" defaultValue="report" disabled={pending}>
        <option value="report">An abuse report</option>
        <option value="dispute">A dispute (the order&apos;s id)</option>
      </Select>
      <TextField id="agent-chat-case" name="case_id" label="Case id" hint="The report id, or the disputed order's id." required disabled={pending} autoComplete="off" />
      <TextField id="agent-chat-reason" name="reason" label="Reason" hint="Goes in the audit log." required maxLength={1000} disabled={pending} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="destructive" loading={pending} pendingLabel="Opening…">
          Open the chat
        </Button>
        {state?.error && <span className="field__err" role="alert">{state.error}</span>}
      </div>
    </form>
  );
}
