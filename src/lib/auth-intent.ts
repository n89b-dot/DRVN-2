/**
 * What a signed-out visitor was trying to do when we asked them to sign in.
 *
 * Marketplace is public, and so is buying: browsing, searching, opening a part
 * sheet, adding to the cart and checking out all work signed out, because
 * purchasing is the service rather than an account feature (a guest identifies
 * themselves with an email at checkout — see src/lib/guest-checkout.ts).
 *
 * What's left here genuinely needs an account to mean anything: an offer that
 * has to stay attached to a person across counters, notifications and expiry;
 * saves and follows, which *are* account state; and listing a part, which
 * needs somewhere to pay out to. Rather than bouncing those clicks straight to
 * /login, the surface explains why and carries the intent through the whole
 * auth lifecycle.
 */
export const AUTH_INTENTS = ["offer", "save", "follow", "sell"] as const;

export type AuthIntent = (typeof AUTH_INTENTS)[number];

export function parseAuthIntent(value: unknown): AuthIntent | null {
  return typeof value === "string" && (AUTH_INTENTS as readonly string[]).includes(value)
    ? (value as AuthIntent)
    : null;
}

export type AuthIntentCopy = {
  /** Dialog heading. */
  title: string;
  /** One line on what the action is. */
  lead: string;
  /** Why the account exists — concrete consequences, not persuasion. */
  reasons: string[];
  /** Primary button. */
  signIn: string;
  /** What happens straight after authentication. */
  returnNote: string;
};

export const AUTH_INTENT_COPY: Record<AuthIntent, AuthIntentCopy> = {
  offer: {
    title: "Sign in to make an offer",
    lead: "An offer is a negotiation with a real seller, so it has to belong to an account.",
    reasons: [
      "The offer stays attached to you, with the seller's reply",
      "You're notified when they accept, counter or decline",
      "Counteroffers and the conversation are kept in one thread",
      "If it's accepted, it becomes an order you can track",
    ],
    signIn: "Sign in and make the offer",
    returnNote: "You'll come straight back to this part when you're in.",
  },
  save: {
    title: "Sign in to save this",
    lead: "Saved parts live on your account so they're there on your next visit.",
    reasons: [
      "Everything you've saved in one list",
      "Kept across devices, not just this browser",
    ],
    signIn: "Sign in and save",
    returnNote: "You'll come straight back to this page when you're in.",
  },
  follow: {
    title: "Sign in to follow",
    lead: "Following is how DRVN knows whose builds to put in front of you.",
    reasons: [
      "New activity from who you follow shows up on Home",
      "Kept across devices, not just this browser",
    ],
    signIn: "Sign in and follow",
    returnNote: "You'll come straight back to this page when you're in.",
  },
  sell: {
    title: "Sign in to list a part",
    lead: "A listing is yours — buyers offer on it and pay you for it.",
    reasons: [
      "Offers and questions on your listing come back to you",
      "Views, watchers and the best live offer, tracked per listing",
      "Payouts land in the account you connect",
    ],
    signIn: "Sign in and list a part",
    returnNote: "You'll land on the listing form as soon as you're in.",
  },
};

/**
 * Where authentication should return to, with the intent encoded so the page
 * can resume the action it interrupted. Kept as a plain internal path with a
 * query string — `safeRedirectPath` rejects anything else, so this can be
 * handed straight to `?next=`.
 */
export function authReturnTo(path: string, intent: AuthIntent): string {
  const [base, existing] = path.split("?");
  const params = new URLSearchParams(existing);
  params.set("action", intent);
  return `${base}?${params.toString()}`;
}

/** `/login?next=…` — the same builder for both auth entry points. */
export function authHref(target: "/login" | "/signup", returnTo: string): string {
  return `${target}?next=${encodeURIComponent(returnTo)}`;
}
