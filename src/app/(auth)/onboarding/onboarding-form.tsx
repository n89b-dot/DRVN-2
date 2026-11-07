"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { Button, CountedField, TextField } from "@/components/ui";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { DISPLAY_NAME_MAX } from "@/lib/limits";

import { completeOnboarding, logout, type AuthState } from "../actions";

type Availability = "idle" | "checking" | "available" | "taken" | "invalid" | "unknown";

export function OnboardingForm({ email, next }: { email: string; next?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(completeOnboarding, {});
  // Controlled fields must not replace what was typed before hydration
  // (see useHydrated): they stay disabled until the page is live.
  const ready = useHydrated();
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
        <fieldset disabled={!ready} className="contents">
        {/* Where this account was headed before it had to pick a handle. */}
        {next && <input type="hidden" name="next" value={next} />}
        <TextField
          id="onb-username"
          label="Handle"
          name="username"
          required
          prefix="@"
          placeholder="drossi_integrale"
          autoComplete="username"
          pattern="[a-zA-Z0-9_]{3,24}"
          value={username}
          onChange={(e) => handleUsernameChange(e.target.value)}
          className="max-w-none"
          hint="Letters, numbers, underscores. Usernames are permanent once set — choose carefully."
          error={state.error}
          status={
            availability === "checking"
              ? "Checking availability…"
              : availability === "available"
                ? "✓ Available"
                : availability === "taken"
                  ? "Already taken"
                  : availability === "invalid" && username.length > 0
                    ? "3-24 characters: letters, numbers, underscores"
                    : ""
          }
        />
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
        {next ? (
          <Button
            type="submit"
            variant="live"
            loading={pending}
            pendingLabel="Saving…"
            className="mt-4 w-full"
          >
            Let&apos;s go
          </Button>
        ) : (
          /* With no destination the product's first step is the car: the
             action lands on the garage, which opens on the add-car form for
             an empty garage. Browsing-only visitors skip straight to Home —
             the submitter's `next` rides along with the form data. */
          <div className="mt-4 grid gap-3">
            <Button
              type="submit"
              variant="live"
              loading={pending}
              pendingLabel="Saving…"
              className="w-full"
            >
              Next: add your car
            </Button>
            <Button
              type="submit"
              name="next"
              value="/home"
              variant="ghost"
              disabled={pending}
              className="w-full"
            >
              Skip — just browsing
            </Button>
          </div>
        )}
        </fieldset>
      </form>

      {/* The way out (N40). Onboarding has no Close, and every other page
          sends an account without a handle back here, so an account that
          can't finish (wrong Google account, no access) could only loop.
          Signing out always works and lands on Login. */}
      <form action={logout} className="authswap">
        <Button type="submit" variant="quiet">
          Not {email || "you"}? Sign out
        </Button>
      </form>
    </div>
  );
}
