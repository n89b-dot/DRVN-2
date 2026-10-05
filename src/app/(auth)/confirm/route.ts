import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { onboardingPath, safeRedirectPath } from "@/lib/safe-redirect";

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" };
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
function origin(request: Request) { return new URL(process.env.NEXT_PUBLIC_SITE_URL || request.url).origin; }
// Every emailed link lands here with a token hash, so it works in whichever
// browser or device the email is opened on. (Supabase's default links carry a
// PKCE code that only the browser that asked can exchange: a reset or signup
// email opened on a phone failed.)
//
//   magiclink  a guest's order link while "Confirm email" is off
//   email      the Confirm signup email: a guest's order link once "Confirm
//              email" is on, or a member confirming a new account
//   recovery   a password reset
//
// Nothing else is accepted.
const LINK_TYPES = new Set(["magiclink", "email", "recovery"]);
type LinkType = "magiclink" | "email" | "recovery";
type Flow = "orders" | "signup" | "recovery";

/**
 * The member emails carry the address the app asked Supabase to return to
 * (`/callback?next=…`) as `redirect_to`. Only its `next` is used, and only as
 * a same-origin path: the address itself is never followed.
 */
function nextFromRedirectTo(value: string | null, site: string): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.origin === site ? safeRedirectPath(url.searchParams.get("next"), "") : "";
  } catch {
    return "";
  }
}

/** What the link is for, and where it leads once verified. */
function linkPlan(type: string, next: string | null, redirectTo: string | null, flow: string | null, site: string): { flow: Flow; next: string } {
  if (type === "recovery") return { flow: "recovery", next: "/login/reset" };
  if (type === "email" && (flow === "signup" || redirectTo)) {
    return { flow: "signup", next: safeRedirectPath(next, "") || nextFromRedirectTo(redirectTo, site) };
  }
  return { flow: "orders", next: safeRedirectPath(next, "/orders") };
}

const COPY: Record<Flow, { title: string; heading: string; body: string; button: string }> = {
  orders: { title: "Open your orders", heading: "Open your DRVN orders", body: "Continue to sign in securely. This link can be used once.", button: "Continue to orders" },
  signup: { title: "Confirm your email", heading: "Confirm your email", body: "Continue to finish setting up your DRVN account. This link can be used once.", button: "Confirm and continue" },
  recovery: { title: "Reset your password", heading: "Reset your DRVN password", body: "Continue to choose a new password. This link can be used once.", button: "Choose a new password" },
};

/** GET/HEAD/prefetch never consumes a token or creates a session. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const token = params.get("token_hash"), type = params.get("type") ?? "", site = origin(request);
  if (!token || token.length > 512 || !LINK_TYPES.has(type)) return NextResponse.redirect(`${site}/login?message=auth-error`, { headers });
  const plan = linkPlan(type, params.get("next"), params.get("redirect_to"), params.get("flow"), site), copy = COPY[plan.flow];
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${copy.title} · DRVN</title></head><body><main><h1>${copy.heading}</h1><p>${copy.body}</p><form method="post" action="/confirm"><input type="hidden" name="token_hash" value="${escape(token)}"><input type="hidden" name="next" value="${escape(plan.next)}"><input type="hidden" name="type" value="${escape(type)}"><input type="hidden" name="flow" value="${plan.flow}"><button type="submit">${copy.button}</button></form></main></body></html>`, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" } });
}

export async function POST(request: Request) {
  const site = origin(request);
  if (request.headers.get("origin") !== site) return new Response("Invalid origin", { status: 403, headers });
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return new Response(null, { status: 415, headers });
  // Bound the actual stream, not only a user-supplied Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400, headers });
  let body = "", size = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); return new Response(null, { status: 413, headers }); }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  const form = new URLSearchParams(body), token = form.get("token_hash");
  // Pages rendered before the type field existed post none: they were magic links.
  const type = form.get("type") ?? "magiclink";
  if (token && token.length <= 512 && LINK_TYPES.has(type)) {
    const client = await createClient();
    const { error } = await client.auth.verifyOtp({ token_hash: token, type: type as LinkType });
    if (!error) {
      const plan = linkPlan(type, form.get("next"), null, form.get("flow"), site);
      let destination = plan.next;
      if (plan.flow === "signup") {
        // The same landing as /callback: a new account picks its handle
        // first, and the destination travels with it.
        const { data: { user } } = await client.auth.getUser();
        const { data: profile } = user
          ? await client.from("profiles").select("username").eq("id", user.id).maybeSingle()
          : { data: null };
        destination = profile?.username ? plan.next || "/home" : onboardingPath(plan.next);
      }
      return NextResponse.redirect(`${site}${destination}`, { status: 303, headers });
    }
  }
  return NextResponse.redirect(`${site}/login?message=auth-error`, { status: 303, headers });
}
