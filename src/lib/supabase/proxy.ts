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
  url.searchParams.set("next", pathname);
  url.searchParams.set("error", "session-unavailable");
  return NextResponse.redirect(url);
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

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
        supabaseResponse = NextResponse.next({ request });
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
    return NextResponse.redirect(url);
  }

  if (user && (isAuthPage || pathname === "/")) {
    // Already signed in: honour a safe ?next= (a sign-in link to
    // /notifications should open Notifications), never another auth page.
    const next = isAuthPage ? safeRedirectPath(request.nextUrl.searchParams.get("next"), "/home") : "/home";
    const dest = /^\/(login|signup)(\/|\?|$)/.test(next) ? "/home" : next;
    return NextResponse.redirect(new URL(dest, request.url));
  }

  return supabaseResponse;
}
