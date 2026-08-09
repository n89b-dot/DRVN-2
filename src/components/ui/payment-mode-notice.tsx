/**
 * The one truthful "test mode" banner. Several surfaces used to render this
 * copy unconditionally, so it kept claiming "no real money moves" even after
 * paymentsAreLive() flips true — this renders nothing once payments are
 * live, and every gated site shares the exact same copy.
 */
export function PaymentModeNotice({ live }: { live: boolean }) {
  if (live) return null;
  return (
    <p className="spec-note">
      <b>Test mode</b> — payments run on Stripe&apos;s test rails; no real money moves.
    </p>
  );
}
