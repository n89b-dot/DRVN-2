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

  const href = await markNotificationRead(id);
  const destination = href && href.startsWith("/") ? href : "/notifications";

  return NextResponse.redirect(`${origin}${destination}`);
}
