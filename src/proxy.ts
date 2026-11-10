import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { blockedMediaKeys, imageRequestObjectKey } from "@/lib/copyright/blocked-media";
import { buildContentSecurityPolicy, reportingEndpointsHeader } from "@/lib/csp";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/_next/image") return imageGate(request);
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
  const key = imageRequestObjectKey(request.nextUrl);
  const blocked = key ? await blockedMediaKeys() : null;
  // No list read yet (a cold instance, the database unreachable): refuse
  // storage photos for now rather than serve every taken-down one (N718).
  if (key && blocked === null) {
    return new NextResponse("Photos are briefly unavailable. Try again in a moment.", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8", "Retry-After": "15" },
    });
  }
  if (key && blocked?.has(key)) {
    return new NextResponse("This image was removed after a copyright notice.", {
      status: 451,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on everything except static assets and images
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)",
    // …and on optimised images, for the copyright gate alone.
    "/_next/image",
  ],
};
