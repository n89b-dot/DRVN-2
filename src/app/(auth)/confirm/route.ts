import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";

/** Token-hash links work in a fresh browser without a PKCE verifier cookie. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL || request.url).origin;
  const tokenHash = searchParams.get("token_hash");
  const next = safeRedirectPath(searchParams.get("next"), "/orders");
  if (tokenHash && tokenHash.length <= 512 && searchParams.get("type") === "magiclink") {
    const client = await createClient();
    const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
    if (!error) return NextResponse.redirect(`${origin}${next}`, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }
  return NextResponse.redirect(`${origin}/login?message=auth-error`, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
