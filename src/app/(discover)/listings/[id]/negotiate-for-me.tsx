"use client";

import { unstable_rethrow } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";

import { Alert, Button, Checkbox, Radio, ResultNote, TextField } from "@/components/ui";
import { startBuyerAgent } from "@/features/agent/actions";
import { formatPrice } from "@/lib/marketplace/taxonomy";

type Style = "firm" | "balanced" | "flexible";

/** Where the agent opens, as negotiate.ts does it: a share of the asking price, never above the max. */
const OPENING_SHARE: Record<Style, number> = { firm: 0.6, balanced: 0.7, flexible: 0.8 };

/**
 * "Negotiate for me" (A3b, docs/design/agent-a3 07): the buyer sets the
 * most they'll pay — on the item, or item + shipping — and a style, and the
 * agent haggles within it. A counter at or under the max is accepted, and
 * the buyer then pays by hand within 24 hours, so they acknowledge that
 * first. The max is private: the seller sees ordinary offers marked "via
 * agent", never the number.
 */
export function NegotiateForMe({
  listingId,
  priceCents,
  shippingCents,
  onCancel,
}: {
  listingId: string;
  priceCents: number;
  shippingCents: number;
  onCancel: () => void;
}) {
  const id = useId();
  const [basis, setBasis] = useState<"item" | "total">("item");
  const [max, setMax] = useState("");
  const [style, setStyle] = useState<Style>("balanced");
  const [ack, setAck] = useState(false);
  const [state, setState] = useState<{ error?: string; ok?: string }>({});
  const [pending, startTransition] = useTransition();

  const maxCents = Math.round(Number(max) * 100);
  const validMax = Number.isFinite(maxCents) && maxCents > 0;
  const itemMax = validMax ? Math.min(priceCents, maxCents - (basis === "total" ? shippingCents : 0)) : null;
  const opening = itemMax != null && itemMax > 0 ? Math.floor((Math.min(priceCents * OPENING_SHARE[style], itemMax)) / 500) * 500 : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setState({});
    startTransition(async () => {
      try {
        setState(await startBuyerAgent({ listingId, ceilingCents: maxCents, ceilingBasis: basis, style, acknowledgeBinding: ack }));
      } catch (error) {
        unstable_rethrow(error);
        setState({ error: "Couldn't confirm your agent started. Check Agent before trying again." });
      }
    });
  }

  if (state.ok) return <ResultNote ok={state.ok} />;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <fieldset className="field">
        <legend className="microlabel">Your max covers</legend>
        <span className="flex flex-wrap gap-x-4" role="radiogroup" aria-label="Your max covers">
          <Radio name={`${id}-basis`} value="item" label="Item" checked={basis === "item"} onChange={() => setBasis("item")} />
          {shippingCents > 0 && (
            <Radio
              name={`${id}-basis`}
              value="total"
              label={`Item + shipping (${formatPrice(shippingCents)})`}
              checked={basis === "total"}
              onChange={() => setBasis("total")}
            />
          )}
        </span>
      </fieldset>
      <TextField
        id={`${id}-max`}
        label="Your max — private"
        prefix="$"
        inputMode="decimal"
        required
        value={max}
        onChange={(event) => setMax(event.target.value)}
        hint={
          validMax
            ? `${basis === "total" ? "Item + shipping" : "Item price"} up to ${formatPrice(maxCents)}. The seller never sees it.`
            : "The seller never sees it."
        }
      />
      <fieldset className="field">
        <legend className="microlabel">Style</legend>
        <span className="flex flex-wrap gap-x-4" role="radiogroup" aria-label="Style">
          {(["firm", "balanced", "flexible"] as const).map((option) => (
            <Radio
              key={option}
              name={`${id}-style`}
              value={option}
              label={option.charAt(0).toUpperCase() + option.slice(1)}
              checked={style === option}
              onChange={() => setStyle(option)}
            />
          ))}
        </span>
        <span className="field__hint">
          How hard it opens.{opening != null ? ` ${style.charAt(0).toUpperCase() + style.slice(1)}: near ${formatPrice(opening)}.` : ""}
        </span>
      </fieldset>
      {validMax && (
        <Alert title={`A counter at ${formatPrice(maxCents)} or less is accepted.`}>
          You then pay by hand within 24 hours. The seller sees normal offers marked “via agent”, never your max.
        </Alert>
      )}
      <Checkbox
        id={`${id}-ack`}
        checked={ack}
        onChange={(event) => setAck(event.target.checked)}
        label="I understand an accepted counter is a purchase I'll pay for within 24 hours."
      />
      <ResultNote error={state.error} />
      <div className="sheet__actions">
        <Button type="button" variant="ghost" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button type="submit" variant="live" loading={pending} pendingLabel="Starting…" disabled={!validMax || !ack} className="flex-1">
          Start negotiating
        </Button>
      </div>
    </form>
  );
}
