import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { blockedMediaKeys, imageRequestObjectKey } from "@/lib/copyright/blocked-media";
import { buildContentSecurityPolicy, reportingEndpointsHeader } from "@/lib/csp";
import { isUnsignedMemberPhoto, signedPhotoLinkExpired } from "@/lib/photo-urls";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // Next serves the optimiser for any path starting /_next/image (a
  // trailing slash included), so the gate must catch every one (#196 review).
  if (request.nextUrl.pathname.startsWith("/_next/image")) return imageGate(request);
  const nonce = randomBytes(24).toString("base64");
  const configured = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://unconfigured.invalid");
  const local = process.env.E2E_TEST_PROJECT_REF === "local-drvn-remediation" && ["localhost", "127.0.0.1"].includes(configured.hostname) && configured.port === "54321";
  const origin = local ? configured.origin : `https://${configured.hostname}`;
  const development = process.env.NODE_ENV === "development";
  const csp = buildContentSecurityPolicy({ nonce, supabaseOrigin: origin, development, allowInsecure: local || development });
  // Override client-provided values; Next reads this request policy when rendering.
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", csp);
  const response = await updateSession(request);
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Reporting-Endpoints", reportingEndpointsHeader());
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/**
 * Optimised images (R69-dmca): a photo a copyright takedown removed is
 * refused here, before Next.js can serve the resized copy it keeps for a
 * month (src/lib/copyright/blocked-media.ts). Nothing else runs for images:
 * no session refresh, no policy headers, as before this gate existed.
 */
async function imageGate(request: NextRequest) {
  // A copyright takedown first (R69-dmca): its 451 says why, whatever the
  // spelling of the link.
  const key = imageRequestObjectKey(request.nextUrl);
  if (key && (await blockedMediaKeys()).has(key)) {
    return new NextResponse("This image was removed after a copyright notice.", {
      status: 451,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  // #178 review: a member photo's signed link that has run out is refused
  // before the optimiser can serve the copy it kept for the object's own
  // (longer) Cache-Control. A member photo in its canonical (unsigned)
  // spelling is refused too: the optimiser may still hold a copy cached
  // before the photos went private (Codex on #178). Pure checks on the URL.
  const source = request.nextUrl.searchParams.get("url");
  if (signedPhotoLinkExpired(source) || isUnsignedMemberPhoto(source)) {
    return new NextResponse("This photo link has expired.", {
      status: 404,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on everything except static assets and images
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)",
    // …and on optimised images, for the copyright and photo gates alone,
    // with or without a trailing slash or more path.
    "/_next/image",
    "/_next/image/:path*",
  ],
};
