import { NextResponse, type NextRequest } from "next/server";

import { requireSameOrigin } from "@/lib/http/origin";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign out from anywhere. The shell's menu posts here (a plain form, so it
 * works before hydration and from a shared component that can't import a
 * route's server action). POST only: a GET would let any page log you out.
 */
export async function POST(request: NextRequest) {
  // Another site's page must not be able to sign a member out.
  const refused = requireSameOrigin(request, { "Cache-Control": "no-store" });
  if (refused) return refused;
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
