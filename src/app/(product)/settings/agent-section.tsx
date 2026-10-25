"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { ActionFooter, Badge, Button, Radio, TileHead } from "@/components/ui";
import { AGENT_MODE_HINT, AGENT_MODE_LABEL, AGENT_MODES, type AgentMode } from "@/lib/agent/mode";

import { saveAgentMode, type AgentModeState } from "./agent-actions";

/**
 * Settings → Agent (AG-7): how far the member's one agent may go — Off,
 * Suggest, or Act within my limits. A section of the settings sheet like
 * Privacy: nothing changes until Save. Dropping below Act also stops any
 * mandate still running, and the result says so.
 */
export function AgentSection({ initialMode, running }: { initialMode: AgentMode; running: number }) {
  const [mode, setMode] = useState<AgentMode>(initialMode);
  const [result, setResult] = useState<AgentModeState>({});
  const [pending, startTransition] = useTransition();
  const willStop = mode !== "act" && running > 0;

  return (
    <section id="agent" className="tile">
      <TileHead label="Agent — how far it may go" end={<Badge>Beta</Badge>} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          startTransition(async () => {
            setResult({});
            try {
              setResult(await saveAgentMode({}, formData));
            } catch {
              setResult({ error: "The response was interrupted. Check Agent, then try saving again." });
            }
          });
        }}
      >
        <fieldset className="field">
          <legend className="microlabel">Your agent</legend>
          <div className="grid gap-1" role="radiogroup" aria-label="Your agent">
            {AGENT_MODES.map((option) => (
              <Radio
                key={option}
                name="agent_mode"
                value={option}
                checked={mode === option}
                onChange={() => {
                  setMode(option);
                  setResult({});
                }}
                label={
                  <>
                    {AGENT_MODE_LABEL[option]}
                    <span className="order__meta block">{AGENT_MODE_HINT[option]}</span>
                  </>
                }
              />
            ))}
          </div>
        </fieldset>
        <p className="field__hint max-w-[62ch]">
          Limits live on each listing: a minimum and target when selling, a private max when buying. Your agent never messages
          anyone else, and you can stop it on any listing from{" "}
          <Link href="/agent" className="jumplink">
            Agent
          </Link>
          .
        </p>
        <ActionFooter
          status={
            result.error ? { kind: "error", message: result.error } : result.ok ? { kind: "ok", message: result.ok } : null
          }
        >
          <Button type="submit" loading={pending} pendingLabel="Saving…" variant={willStop ? "destructive" : "default"}>
            {willStop ? `Save and stop ${running} running` : "Save agent setting"}
          </Button>
        </ActionFooter>
      </form>
    </section>
  );
}
