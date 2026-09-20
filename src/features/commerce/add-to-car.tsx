"use client";

import { useState, useTransition } from "react";

import { Button, Dialog } from "@/components/ui";

import { addPurchaseToCar } from "./add-to-car-actions";

export type AddToCarTarget = { id: string; name: string };

/**
 * C-1's control: "Add to a car in your garage", per purchased item.
 *
 * Per item rather than per order, because an order can hold several parts
 * and they may not all be going on the same car. The picker is a Dialog
 * rather than an inline select because choosing a car is a decision, and
 * because a member with one car should not have to think about it — that
 * case skips straight to the confirmation.
 */
export function AddToCar({
  orderItemId,
  title,
  cars,
}: {
  orderItemId: string;
  title: string;
  cars: AddToCarTarget[];
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!cars.length) return null;
  if (done) {
    return (
      <p role="status" className="field__ok !block">
        {done}
      </p>
    );
  }

  function add(carId: string) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("order_item_id", orderItemId);
      formData.set("car_id", carId);
      const result = await addPurchaseToCar({}, formData);
      if (result?.error) setError(result.error);
      else {
        // A repeat tap lands here too, with "already on this car" — the same
        // answer either way, which is what idempotent should feel like.
        setDone(result?.ok ?? "Added to your build.");
        setOpen(false);
      }
    });
  }

  // One car: there is nothing to choose, so the button names the car and
  // does it. The dialog is for a garage where "which one?" is a question.
  const only = cars.length === 1 ? cars[0] : null;

  return (
    <>
      {only ? (
        <Button variant="ghost" onClick={() => add(only.id)} loading={pending} pendingLabel="Adding…">
          Add to {only.name}
        </Button>
      ) : (
        <Button variant="ghost" onClick={() => setOpen(true)}>
          Add to a car
        </Button>
      )}
      {error && (
        <p role="alert" className="field__err">
          {error}
        </p>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} label={`Add ${title} to a car`}>
        <h2 className="text-section">Which car did it go on?</h2>
        <p className="text-body text-dim">
          It joins that car&apos;s build sheet, recorded as bought on DRVN.
        </p>
        <div className="mt-4 grid gap-2">
          {cars.map((car) => (
            <Button key={car.id} variant="ghost" onClick={() => add(car.id)} loading={pending}>
              {car.name}
            </Button>
          ))}
        </div>
      </Dialog>
    </>
  );
}
