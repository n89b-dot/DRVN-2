"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { Button, CountedField } from "@/components/ui";
import { DISPLAY_NAME_MAX } from "@/lib/limits";

import { completeOnboarding, type AuthState } from "../actions";

type Availability = "idle" | "checking" | "available" | "taken" | "invalid" | "unknown";

export function OnboardingForm({ email, next }: { email: string; next?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(completeOnboarding, {});
  const [username, setUsername] = useState("");
  const [availability, setAvailability] = useState<Availability>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  // Synchronous states (idle/invalid/checking) are set in the change handler;
  // the effect only owns the debounced network step, so no setState runs
  // synchronously inside it.
  const handleUsernameChange = (raw: string) => {
    setUsername(raw);
    const value = raw.trim().toLowerCase();
    if (!value) setAvailability("idle");
    else if (!/^[a-z0-9_]{3,24}$/.test(value)) setAvailability("invalid");
    else setAvailability("checking");
  };

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (availability !== "checking") return;

    const value = username.trim().toLowerCase();
    const thisRequest = ++requestIdRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/onboarding/username-check?username=${encodeURIComponent(value)}`
        );
        const data = (await res.json()) as { available: boolean; reason?: string };
        if (requestIdRef.current !== thisRequest) return;
        if (data.reason === "unknown") setAvailability("unknown");
        else setAvailability(data.available ? "available" : "taken");
      } catch {
        if (requestIdRef.current === thisRequest) setAvailability("unknown");
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [username, availability]);

  return (
    <div>
      <span className="microlabel">One last thing</span>
      <h1 className="mt-2 text-[clamp(26px,4vw,36px)] font-[600] leading-[1.05] tracking-[-0.02em]">
        What should we <span className="text-live">call you?</span>
      </h1>
      <p className="kv mt-3 text-dim">Signed up as {email}</p>

      <form action={action} className="mt-6">
        {/* Where this account was headed before it had to pick a handle. */}
        {next && <input type="hidden" name="next" value={next} />}
        {/* Kept manual: the live role="status" availability line (with its own
            stable describedby id) has no TextField equivalent. */}
        <div className={`field ${state.error ? "is-invalid" : ""}`}>
          <label htmlFor="onb-username" className="microlabel">
            Handle
          </label>
          <input
            id="onb-username"
            name="username"
            required
            placeholder="drossi.integrale"
            autoComplete="username"
            pattern="[a-zA-Z0-9_]{3,24}"
            value={username}
            onChange={(e) => handleUsernameChange(e.target.value)}
            aria-describedby="onb-username-hint onb-username-status"
            className="ctl max-w-none"
          />
          <span id="onb-username-hint" className="field__hint">
            Letters, numbers, underscores. Usernames are permanent once set — choose
            carefully.
          </span>
          <span id="onb-username-status" role="status" aria-live="polite" className="field__hint">
            {availability === "checking" && "Checking availability…"}
            {availability === "available" && "✓ Available"}
            {availability === "taken" && "Already taken"}
            {availability === "invalid" &&
              username.length > 0 &&
              "3-24 characters: letters, numbers, underscores"}
          </span>
          {state.error && (
            <span role="alert" aria-live="polite" className="field__err">
              {state.error}
            </span>
          )}
        </div>
        <CountedField
          id="onb-display-name"
          name="display_name"
          label="Display name"
          max={DISPLAY_NAME_MAX}
          required
          placeholder="Dana Rossi"
          autoComplete="name"
          hint="You can change this any time in settings."
        />
        <Button type="submit" variant="live" disabled={pending} className="mt-4 w-full">
          {pending ? "Saving…" : "Let's go"}
        </Button>
      </form>
    </div>
  );
}
