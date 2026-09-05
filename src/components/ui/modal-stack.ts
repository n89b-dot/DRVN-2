/** Shared ownership for native dialogs and responsive sheets. */
const stack: HTMLElement[] = [];
let overflow = "", padding = "";
export function lockModal(element: HTMLElement) {
  if (stack.includes(element)) return;
  if (!stack.length) {
    overflow = document.body.style.overflow; padding = document.body.style.paddingRight;
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gutter > 0) document.body.style.paddingRight = `${gutter}px`;
  }
  stack.push(element);
}
export function isTopModal(element: HTMLElement | null) { return stack.at(-1) === element; }
export function unlockModal(element: HTMLElement) {
  const position = stack.indexOf(element); if (position < 0) return;
  stack.splice(position, 1);
  if (!stack.length) { document.body.style.overflow = overflow; document.body.style.paddingRight = padding; }
}
