import { NextResponse } from "next/server";

import { markNotificationRead } from "../../actions";

/**
 * The click-through for a notification row: mark it read, then send the
 * reader on to wherever it actually points. Kept as a route handler (rather
 * than a `<form>` wrapping each row) so the row stays a normal link.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { origin } = new URL(request.url);

  const result = await markNotificationRead(id);
  if ("error" in result) {
    const destination = result.error === "write_failed" ? "/notifications?notice=read_failed" : "/notifications";
    return NextResponse.redirect(`${origin}${destination}`);
  }
  const destination = result.href?.startsWith("/") ? result.href : "/notifications";

  return NextResponse.redirect(`${origin}${destination}`);
}
