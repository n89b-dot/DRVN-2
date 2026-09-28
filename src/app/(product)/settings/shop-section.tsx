"use client";

import { useActionState } from "react";

import { ActionFooter, Button, Select, TileHead } from "@/components/ui";
import {
  becomeShop,
  updateShopReturnPolicy,
  type ShopState,
} from "@/features/commerce/shop-actions";

/**
 * Settings → Shop (0056). Same account, shop features on top: a self-declared
 * shop badge state (never "verified" — DRVN grants that separately) and the
 * small preference-return policy. Policy changes only affect FUTURE sales;
 * every past order keeps the policy frozen in its purchase snapshot.
 */
export type ShopSettings = {
  isShop: boolean;
  verified: boolean;
  returnsAccepted: boolean;
  returnWindowDays: number;
};

function Feedback({ state }: { state: ShopState }) {
  if (!state.error && !state.ok) return null;
  return (
    <p
      role={state.error ? "alert" : "status"}
      aria-live="polite"
      className={state.error ? "field__err" : "chip chip--ok"}
    >
      {state.error ?? state.ok}
    </p>
  );
}

export function ShopSection({ shop }: { shop: ShopSettings }) {
  const [convertState, convertAction, convertPending] = useActionState<ShopState, FormData>(
    becomeShop,
    {}
  );
  const [policyState, policyAction, policyPending] = useActionState<ShopState, FormData>(
    updateShopReturnPolicy,
    {}
  );

  return (
    <section id="shop" className="tile">
      <TileHead
        label="Shop — selling as a business"
        end={
          shop.isShop ? (
            shop.verified ? (
              <span className="chip chip--ok">Verified shop</span>
            ) : (
              <span className="chip">Shop</span>
            )
          ) : undefined
        }
      />

      {/* Sellers look here for store settings; two of them live with the
          profile fields because they show on the profile's Parts tab. */}
      <p className="field__hint mt-2 max-w-[62ch]">
        Your store note and default offer floor are under{" "}
        <a href="#profile" className="jumplink">
          Profile
        </a>
        .
      </p>
      {!shop.isShop ? (
        <form action={convertAction} className="mt-3 grid gap-3">
          <p className="field__hint max-w-[62ch]">
            Selling a lot? A shop keeps the same account — cars, builds,
            followers — and adds business features: a storefront-first profile
            and an optional return policy. Verification is a separate review
            DRVN performs; switching never grants a verified badge by itself.
          </p>
          <div>
            <Button type="submit" loading={convertPending} pendingLabel="Switching…">
              Sell as a shop
            </Button>
          </div>
          <Feedback state={convertState} />
        </form>
      ) : (
        <form action={policyAction} className="mt-3 grid gap-3">
          <p className="field__hint max-w-[62ch]">
            DRVN Protection always covers not-as-described, wrong-item and
            transit-damage claims. On top of that, a shop can voluntarily take
            ordinary change-of-mind returns. Buyers pay return postage on
            these; original shipping isn&apos;t refunded.
          </p>
          <label className="flex items-center gap-2 text-micro">
            <input
              type="checkbox"
              name="returns_accepted"
              defaultChecked={shop.returnsAccepted}
              className="sq"
            />
            Accept change-of-mind returns
          </label>
          <Select
            id="shop-return-window"
            label="Return window"
            name="return_window_days"
            defaultValue={String(shop.returnWindowDays)}
            className="!max-w-none"
            fieldClassName="!mb-0"
            hint="Counted from delivery. Orders already sold keep the policy they were bought under."
          >
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
          </Select>
          <ActionFooter
            status={
              policyState.ok ? { kind: "ok", message: "Policy saved" } : null
            }
          >
            <Button type="submit" loading={policyPending} pendingLabel="Saving…">
              Save return policy
            </Button>
          </ActionFooter>
          {policyState.error && (
            <p role="alert" aria-live="polite" className="field__err">
              {policyState.error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
