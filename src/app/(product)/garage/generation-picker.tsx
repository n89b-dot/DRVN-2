"use client";

import { unstable_rethrow } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button, ResultNote, Select } from "@/components/ui";
import type { GenerationChoice } from "@/lib/vehicles/generation-choices";

import { setCarGeneration, type ActionState } from "./actions";

/**
 * Which generation is this car? Asked on the sheet only on a changeover year
 * (two or more generations of the model cover it — vehicles.md,
 * "Generations"). The owner's choice is kept while it still fits; the
 * database's trigger marks it as theirs, never the client.
 */
export function GenerationPicker({ carId, choices }: { carId: string; choices: GenerationChoice[] }) {
  const id = useId();
  const [choice, setChoice] = useState("");
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  if (state.ok) return <ResultNote ok={state.ok} />;

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!choice || pending) return;
        const data = new FormData();
        data.set("car_id", carId);
        data.set("generation_id", choice);
        setState({});
        startTransition(async () => {
          try {
            setState(await setCarGeneration({}, data));
          } catch (error) {
            unstable_rethrow(error);
            setState({ error: "Couldn't confirm the save. Reload to see whether it took." });
          }
        });
      }}
    >
      <Select
        id={`${id}-generation`}
        label="Which generation?"
        value={choice}
        onChange={(event) => setChoice(event.target.value)}
        hint="This model changed over in your car's year, so DRVN can't tell from the year alone. Fitment uses your answer."
        fieldClassName="!mb-0"
        className="max-w-none"
      >
        <option value="">Choose…</option>
        {choices.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>
      <ResultNote error={state.error} />
      <Button type="submit" variant="ghost" disabled={!choice} loading={pending} pendingLabel="Saving…" className="justify-self-start">
        Save generation
      </Button>
    </form>
  );
}
