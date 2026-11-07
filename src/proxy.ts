import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";

import { buildContentSecurityPolicy, reportingEndpointsHeader } from "@/lib/csp";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
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

export const config = {
  matcher: [
    // Run on everything except static assets and images
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)",
  ],
};
