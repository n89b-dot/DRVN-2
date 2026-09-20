"use client";

import { useState, useTransition } from "react";

import { setMainCar } from "../../actions";

/**
 * P-5, the one place a member answers "which car do you actually mean?".
 *
 * It sits with the car's own settings rather than on a garage-wide screen
 * because that is where you are when the answer occurs to you — editing the
 * car you care most about. Unsetting is a real answer too: with no main car,
 * every surface falls back to newest-first, which is exactly what they all
 * did before this existed.
 */
export function MainCarToggle({ carId, isMain }: { carId: string; isMain: boolean }) {
  const [main, setMain] = useState(isMain);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    setError(null);
    const previous = main;
    setMain(next);
    startTransition(async () => {
      const formData = new FormData();
      if (next) formData.set("car_id", carId);
      const result = await setMainCar({}, formData);
      if (result?.error) {
        setMain(previous);
        setError(result.error);
      }
    });
  }

  return (
    <div>
      <label className="flex items-center gap-2 font-mono text-micro uppercase tracking-[0.1em] text-dim">
        <input
          type="checkbox"
          checked={main}
          disabled={pending}
          onChange={(e) => toggle(e.target.checked)}
          className="sq"
        />
        My main car — leads your profile, garage and car lists
      </label>
      {error && (
        <p role="alert" className="field__err">
          {error}
        </p>
      )}
    </div>
  );
}
