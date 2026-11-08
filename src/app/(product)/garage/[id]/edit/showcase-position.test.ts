import { describe, expect, it } from "vitest";

import { nudgePin, pinFromActivation, pinPositionLabel } from "./showcase-position";

const rect = { left: 100, top: 50, width: 400, height: 200 };

describe("N67 showcase pins can be placed from the keyboard", () => {
  it("drops a keyboard-activated pin in the middle, and a click where it landed", () => {
    expect(pinFromActivation({ clientX: 0, clientY: 0, detail: 0 }, rect)).toEqual({ x: 0.5, y: 0.5 });
    expect(pinFromActivation({ clientX: 200, clientY: 100, detail: 1 }, rect)).toEqual({ x: 0.25, y: 0.25 });
  });

  it("moves a focused pin with the arrow keys, further with Shift, never off the photo", () => {
    expect(nudgePin({ x: 0.5, y: 0.5 }, "ArrowRight", false)).toEqual({ x: 0.52, y: 0.5 });
    expect(nudgePin({ x: 0.5, y: 0.5 }, "ArrowUp", true)).toEqual({ x: 0.5, y: 0.4 });
    expect(nudgePin({ x: 0.01, y: 0.99 }, "ArrowLeft", true)).toEqual({ x: 0, y: 0.99 });
    expect(nudgePin({ x: 0.5, y: 0.99 }, "ArrowDown", true)).toEqual({ x: 0.5, y: 1 });
    expect(nudgePin({ x: 0.5, y: 0.5 }, "Tab", false)).toBeNull();
  });

  it("announces where a pin is and how to move it", () => {
    expect(pinPositionLabel(0, { x: 0.25, y: 0.5 })).toBe(
      "Pin 1: 25% across, 50% down. Use the arrow keys to move it, Shift for bigger steps."
    );
  });
});
