import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { hasSupabaseConfig, isProduction, publicKey } from "@/lib/env";
import { reportError } from "@/lib/monitoring";
import { safeRedirectPath } from "@/lib/safe-redirect";

/**
 * Routes that mean nothing without an account.
 *
 * `/cart` and `/checkout` are deliberately absent: buying is the service, and
 * a guest fills a cart and pays without an account, identifying themselves
 * with an email at the payment step. `/orders` stays gated — a *placed* order
 * is account state, and a guest reaches theirs through the signed
 * guest-checkout receipt (`/order-placed`) or the emailed link.
 */
const PRODUCT_PREFIXES = [
  "/home",
  "/garage",
  "/profile",
  "/saved",
  "/notifications",
  "/settings",
  "/sell",
  "/orders",
  "/offers",
  "/messages",
  "/selling",
  "/payouts",
];

/** Members-only pages under a public prefix: /listings/<id> is a public
 *  listing, but /listings (your ledger) and /listings/<id>/edit are yours. */
const PRODUCT_PATTERNS = [/^\/listings\/?$/, /^\/listings\/[^/]+\/edit\/?$/];

const AUTH_PAGES = ["/login", "/signup"];

function isProductPath(pathname: string) {
  return (
    PRODUCT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ||
    PRODUCT_PATTERNS.some((pattern) => pattern.test(pathname))
  );
}

/**
 * A redirect that keeps the session (RR-06). A refresh inside getClaims()
 * rotates the refresh token and writes the new cookies onto the pass-through
 * response; a fresh NextResponse.redirect() would drop them, leaving the
 * browser with a refresh token the server has already spent — signed out on
 * the next request, or looping through /login. Every redirect after the
 * session check carries the latest cookies, options and removals included.
 */
function redirectKeepingSession(url: URL | string, from: NextResponse, request: NextRequest) {
  const response = request.headers.has("next-action")
    ? actionRedirect(new URL(url, request.url))
    : NextResponse.redirect(url, request.method === "GET" || request.method === "HEAD" ? 307 : 303);
  for (const cookie of from.cookies.getAll()) response.cookies.set(cookie);
  return response;
}

/**
 * A Server Action called from the page is a fetch, and fetch follows an HTTP
 * redirect by itself: a 307 re-sent the action as a POST to /login, which
 * answered with something unrelated, so the page saw a failed call ("Couldn't
 * confirm the update", a spinner that never ends) instead of a sign-in.
 *
 * So answer in the shape Next's own `redirect()` uses for a fetch action — a
 * 200 with `x-action-redirect: <path>;<push|replace>` and no body — and the
 * client router loads the destination as a full page. Any other non-GET (a
 * form posted without JavaScript) gets a 303, so the browser lands on the
 * sign-in page with a GET rather than re-posting to it.
 */
function actionRedirect(url: URL) {
  return new NextResponse(null, {
    status: 200,
    headers: { "x-action-redirect": `${url.pathname}${url.search};replace` },
  });
}

/**
 * Fail closed. If we cannot establish who the caller is, a product route must
 * not render — previously this path returned the request unchanged, so a
 * misconfigured or unreachable Supabase left every authed route ungated.
 * Public routes still pass through: they show nothing a visitor shouldn't see.
 */
function denyProductRoutes(request: NextRequest, response: NextResponse, reason: string) {
  const { pathname } = request.nextUrl;
  if (!isProductPath(pathname)) return response;

  reportError(`[proxy] refusing ${pathname}: ${reason}`);
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  // The whole destination, query included, as on the signed-out redirect.
  url.searchParams.set("next", pathname + request.nextUrl.search);
  url.searchParams.set("error", "session-unavailable");
  return redirectKeepingSession(url, response, request);
}

export async function updateSession(request: NextRequest) {
  // Admin pages learn which page they are, so the 15-minute MFA check can
  // send an admin back where they were after the code (guard.ts).
  const forwarded = new Headers(request.headers);
  if (request.nextUrl.pathname.startsWith("/admin") || request.nextUrl.pathname.startsWith("/docs")) {
    forwarded.set("x-drvn-path", request.nextUrl.pathname + request.nextUrl.search);
  }
  let supabaseResponse = NextResponse.next({ request: { headers: forwarded } });

  if (!hasSupabaseConfig()) {
    // Local dev without env vars should stay browsable; a deployed environment
    // missing its credentials is a misconfiguration, not a mode of operation.
    if (isProduction) {
      return denyProductRoutes(request, supabaseResponse, "Supabase env vars are missing");
    }
    return supabaseResponse;
  }

  // hasSupabaseConfig() above already proved both are present.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = publicKey()!;

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        // The refreshed session must reach the page too, not just the browser.
        forwarded.set("cookie", request.cookies.toString());
        supabaseResponse = NextResponse.next({ request: { headers: forwarded } });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // getClaims() verifies the JWT locally against Supabase's cached JWKS
  // (this project uses the new asymmetric signing keys), so the happy path
  // costs no network round trip — unlike getUser(), which phoned the auth
  // server on every single request and added 80–770ms before any page code
  // ran. Token refresh still happens through the client's cookie handlers
  // when the access token has expired.
  let user = null;
  try {
    const { data } = await supabase.auth.getClaims();
    user = data?.claims ?? null;
  } catch (error) {
    reportError("[proxy] unable to verify session", error);
    return denyProductRoutes(request, supabaseResponse, "Supabase was unreachable");
  }

  const { pathname } = request.nextUrl;
  const isProductRoute = isProductPath(pathname);
  // A recovery callback establishes a real session before it redirects here;
  // this one authenticated auth route must remain reachable so that session
  // can set the new password.
  const isPasswordRecovery = pathname === "/login/reset";
  const isAuthPage = !isPasswordRecovery && AUTH_PAGES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (!user && isProductRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // The whole destination, query included — /orders?view=sales comes back
    // to Sales, not to whichever tab Orders defaults to.
    url.searchParams.set("next", pathname + request.nextUrl.search);
    // A failed refresh clears the session cookies; the redirect carries
    // those removals too.
    return redirectKeepingSession(url, supabaseResponse, request);
  }

  if (user && (isAuthPage || pathname === "/")) {
    // Already signed in: honour a safe ?next= (a sign-in link to
    // /notifications should open Notifications), never another auth page.
    const next = isAuthPage ? safeRedirectPath(request.nextUrl.searchParams.get("next"), "/home") : "/home";
    const dest = /^\/(login|signup)(\/|\?|$)/.test(next) ? "/home" : next;
    return redirectKeepingSession(new URL(dest, request.url), supabaseResponse, request);
  }

  return supabaseResponse;
}
