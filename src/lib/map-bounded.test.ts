import { expect, it } from "vitest";
import { mapBounded } from "./map-bounded";
it("caps provider concurrency and waits for peers after one operation fails", async () => {
  let active = 0, peak = 0;
  const completed: number[] = [];
  await expect(mapBounded([0, 1, 2, 3, 4], 2, async (item) => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--; completed.push(item);
    if (item === 1) throw new Error("provider unavailable");
  })).rejects.toThrow("Batch operations failed");
  expect(peak).toBe(2);
  expect(active).toBe(0);
  expect(completed.sort()).toEqual([0, 1, 2, 3, 4]);
});
