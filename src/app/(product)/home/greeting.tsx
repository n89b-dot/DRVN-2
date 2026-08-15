"use client";

/**
 * Time-of-day greeting in the *viewer's* clock. The server renders its own
 * guess (deployment timezone), and `suppressHydrationWarning` lets the client
 * correct the text on hydration without a mismatch error — the alternative
 * (render nothing on the server) would flash an empty heading.
 */
function computeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Morning";
  if (h < 18) return "Afternoon";
  return "Evening";
}

export function Greeting() {
  return <span suppressHydrationWarning>{computeGreeting()}</span>;
}
