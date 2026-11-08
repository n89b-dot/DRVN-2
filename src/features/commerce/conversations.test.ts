import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

import { enquiriesByPerson, loadInbox, type EnquiryMessageRow } from "./conversations";

const ME = "buyer";
const SELLER = "seller";
const part = { id: "part-1", title: "Garrett turbo", seller_id: SELLER, status: "active", price_cents: 120000 };

function enquiry(over: Partial<EnquiryMessageRow> = {}): EnquiryMessageRow {
  return { listing_id: "part-1", sender_id: ME, recipient_id: SELLER, created_at: "2026-11-07T12:00:00Z", listings: part, ...over };
}

/** Just enough of the Supabase client for loadInbox: every chain resolves to its table's rows. */
function fakeSupabase(rows: Record<string, unknown[]>, conversations: unknown[]) {
  return {
    rpc: async () => ({ data: conversations, error: null }),
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "or", "is", "not", "order", "limit", "lt"]) query[method] = () => query;
      query.then = (resolve: (value: unknown) => void) => resolve({ data: rows[table] ?? [], error: null });
      return query;
    },
  } as unknown as Parameters<typeof loadInbox>[0];
}

describe("R-directcontact: listing enquiries are deals in the inbox", () => {
  it("files each enquiry under the other person, once per listing, newest first", () => {
    const byPerson = enquiriesByPerson(
      [
        enquiry({ created_at: "2026-11-07T13:00:00Z", sender_id: SELLER, recipient_id: ME }),
        enquiry(),
        enquiry({ listing_id: "part-2", listings: { ...part, id: "part-2", title: "Intake" }, created_at: "2026-11-07T11:00:00Z" }),
      ],
      ME,
      [SELLER],
    );
    expect(byPerson.get(SELLER)).toEqual([
      expect.objectContaining({ listing_id: "part-1", at: "2026-11-07T13:00:00Z", seller_id: SELLER }),
      expect.objectContaining({ listing_id: "part-2", title: "Intake" }),
    ]);
  });

  it("ignores a listing that belongs to neither of them, and people not on the page", () => {
    const byPerson = enquiriesByPerson(
      [enquiry({ listings: { ...part, seller_id: "someone-else" } }), enquiry({ recipient_id: "not-listed" })],
      ME,
      [SELLER],
    );
    expect(byPerson.get(SELLER)).toEqual([]);
    expect(byPerson.has("not-listed")).toBe(false);
  });

  it("shows an enquiry-only conversation's deal in the inbox row", async () => {
    const supabase = fakeSupabase(
      { messages: [{ id: "m1", kind: "message", ...enquiry() }], profiles: [], orders: [], offers: [] },
      [{ id: "c1", counterparty_id: SELLER, last_message_id: "m1", last_message_at: "2026-11-07T12:00:00Z", last_message_preview: "Does it fit?", unread_count: 0, total_count: 1 }],
    );
    const inbox = await loadInbox(supabase, ME, { filter: "buying", query: "", page: 1 });
    expect(inbox.rows[0].deals).toEqual([
      expect.objectContaining({ key: "listing:part-1", kind: "listing", side: "buying", label: "You asked about it" }),
    ]);
  });
});
