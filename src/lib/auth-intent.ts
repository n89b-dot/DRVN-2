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
export const AUTH_INTENTS = [
  "offer",
  "save",
  "save_search",
  "follow",
  "sell",
  "like",
  "reply",
  "react",
] as const;

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
  /** Primary button. Short — "Sign in" — because it sits half-width beside
   *  "Create account" and the heading already names the action; the long
   *  "Sign in and make the offer" wrapped to four lines on a phone. */
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
    signIn: "Sign in",
    returnNote: "You'll come straight back to this part when you're in.",
  },
  save: {
    title: "Sign in to save this",
    lead: "Saved things live on your account so they're there on your next visit.",
    reasons: [
      "Everything you've saved in one list",
      "Kept across devices, not just this browser",
    ],
    signIn: "Sign in",
    returnNote: "You'll come straight back to this page when you're in.",
  },
  save_search: {
    title: "Sign in to save this search",
    lead: "Keep these search criteria on your account for your next visit.",
    reasons: ["Restore this category, vehicle and filters", "Alerts stay off unless you choose to enable them"],
    signIn: "Sign in",
    returnNote: "You'll return to these results and the search will be saved.",
  },
  follow: {
    title: "Sign in to follow",
    lead: "Following is how DRVN knows whose builds to put in front of you.",
    reasons: [
      "New activity from who you follow shows up on Home",
      "Kept across devices, not just this browser",
    ],
    signIn: "Sign in",
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
    signIn: "Sign in",
    returnNote: "You'll land on the listing form as soon as you're in.",
  },
  like: {
    title: "Sign in to like this",
    lead: "A like tells the person behind it that someone noticed — so it comes from an account.",
    reasons: [
      "They see who liked their build, update or part",
      "What you like helps shape what Explore shows you",
    ],
    signIn: "Sign in",
    returnNote: "You'll come straight back to this page when you're in.",
  },
  reply: {
    title: "Sign in to reply",
    lead: "Replies are signed with your name, so the conversation knows who's talking.",
    reasons: [
      "Your reply shows under this update with your name on it",
      "You're notified when someone answers you",
    ],
    signIn: "Sign in",
    returnNote: "You'll come straight back to this update when you're in.",
  },
  react: {
    title: "Sign in to react",
    lead: "A reaction is a quick nod to the builder, and it's counted against your account.",
    reasons: [
      "The builder sees who reacted",
      "One reaction per person, so the counts mean something",
    ],
    signIn: "Sign in",
    returnNote: "You'll come straight back to this update when you're in.",
  },
};

/** What a signed-out save is about — the dialog names it rather than
 *  calling every build a part. */
export type AuthIntentSubject = "part" | "build" | "update";

const SAVE_LEAD: Record<AuthIntentSubject, string> = {
  part: "Saved parts live on your account so they're there on your next visit.",
  build: "Saved builds live on your account, so you can find this car again.",
  update: "Saved updates live on your account, so you can come back to this one.",
};

const LIKE_TITLE: Record<AuthIntentSubject, string> = {
  part: "Sign in to like this part",
  build: "Sign in to like this build",
  update: "Sign in to like this update",
};

/** The copy for an intent, worded for what it's about when that's known. */
export function authIntentCopy(intent: AuthIntent, subject?: AuthIntentSubject): AuthIntentCopy {
  const copy = AUTH_INTENT_COPY[intent];
  if (!subject) return copy;
  if (intent === "save") return { ...copy, lead: SAVE_LEAD[subject] };
  if (intent === "like") return { ...copy, title: LIKE_TITLE[subject] };
  return copy;
}

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
