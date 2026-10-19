"use client";

import { unstable_rethrow, useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button, ResultNote } from "@/components/ui";

import { filtersFromSentence } from "./sentence-filters-action";

/**
 * Under a search that reads like a sentence ("used coilovers for an E46
 * under $500"): one quiet offer to turn it into filters. The result is an
 * ordinary Marketplace URL, so each filter it set shows as a removable chip.
 */
export function SentenceFilters({ sentence }: { sentence: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button
        variant="quiet"
        loading={pending}
        pendingLabel="Working it out…"
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await filtersFromSentence(sentence);
              if (result.href) router.push(result.href);
              else setError(result.error ?? null);
            } catch (caught) {
              unstable_rethrow(caught);
              setError("Couldn't do that just now. The filters below still work.");
            }
          });
        }}
      >
        Turn this into filters
      </Button>
      <ResultNote error={error} />
    </div>
  );
}
