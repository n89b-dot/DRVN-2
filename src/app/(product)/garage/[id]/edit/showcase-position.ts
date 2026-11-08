/**
 * Showcase pin placement without a pointer (N67, OS-W23). Pins were placed
 * only from click coordinates; keyboard activation gave no meaningful
 * position. A keyboard "click" now drops a pin in the middle of the photo,
 * and a focused pin moves with the arrow keys (Shift for bigger steps).
 */
export type PinPosition = { x: number; y: number };

export const PIN_STEP = 0.02;
export const PIN_BIG_STEP = 0.1;

const clamp = (v: number) => Math.min(1, Math.max(0, Math.round(v * 1000) / 1000));

/** Where a click on the photo puts a pin. `detail` 0 means the keyboard
 *  activated the button (Enter/Space), so there is no pointer position. */
export function pinFromActivation(
  event: { clientX: number; clientY: number; detail: number },
  rect: { left: number; top: number; width: number; height: number },
): PinPosition {
  if (event.detail === 0 || rect.width <= 0 || rect.height <= 0) return { x: 0.5, y: 0.5 };
  return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
}

/** The pin's next position for an arrow key, or null for any other key. */
export function nudgePin(position: PinPosition, key: string, big: boolean): PinPosition | null {
  const step = big ? PIN_BIG_STEP : PIN_STEP;
  switch (key) {
    case "ArrowLeft":
      return { x: clamp(position.x - step), y: position.y };
    case "ArrowRight":
      return { x: clamp(position.x + step), y: position.y };
    case "ArrowUp":
      return { x: position.x, y: clamp(position.y - step) };
    case "ArrowDown":
      return { x: position.x, y: clamp(position.y + step) };
    default:
      return null;
  }
}

/** What a screen reader hears for a pin. */
export function pinPositionLabel(index: number, position: PinPosition): string {
  return `Pin ${index + 1}: ${Math.round(position.x * 100)}% across, ${Math.round(position.y * 100)}% down. Use the arrow keys to move it, Shift for bigger steps.`;
}
