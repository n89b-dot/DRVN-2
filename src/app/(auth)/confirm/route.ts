import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" };
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
function origin(request: Request) { return new URL(process.env.NEXT_PUBLIC_SITE_URL || request.url).origin; }
// A guest's order link is a magic link while their account is unconfirmed and
// "Confirm email" is off; with it on (staging, production) Supabase sends the
// Confirm signup email instead, whose token verifies as type "email". Both
// sign the guest in the same way; nothing else is accepted here.
const LINK_TYPES = new Set(["magiclink", "email"]);
type LinkType = "magiclink" | "email";

/** GET/HEAD/prefetch never consumes a token or creates a session. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const token = params.get("token_hash"), next = safeRedirectPath(params.get("next"), "/orders"), type = params.get("type") ?? "";
  if (!token || token.length > 512 || !LINK_TYPES.has(type)) return NextResponse.redirect(`${origin(request)}/login?message=auth-error`, { headers });
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open your orders · DRVN</title></head><body><main><h1>Open your DRVN orders</h1><p>Continue to sign in securely. This link can be used once.</p><form method="post" action="/confirm"><input type="hidden" name="token_hash" value="${escape(token)}"><input type="hidden" name="next" value="${escape(next)}"><input type="hidden" name="type" value="${escape(type)}"><button type="submit">Continue to orders</button></form></main></body></html>`, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" } });
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
    if (!error) return NextResponse.redirect(`${site}${safeRedirectPath(form.get("next"), "/orders")}`, { status: 303, headers });
  }
  return NextResponse.redirect(`${site}/login?message=auth-error`, { status: 303, headers });
}
