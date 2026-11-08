import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

import { enquiriesByPerson, loadInbox, loadThread, type EnquiryTopicRow } from "./conversations";

const ME = "buyer";
const SELLER = "seller";

function topic(over: Partial<EnquiryTopicRow> = {}): EnquiryTopicRow {
  return { other_id: SELLER, listing_id: "part-1", last_at: "2026-11-07T12:00:00Z", title: "Garrett turbo", seller_id: SELLER, status: "active", price_cents: 120000, ...over };
}

/**
 * Just enough of the Supabase client for the loaders: every chain resolves
 * to its table's rows (newest first, honouring limit), and each RPC to its
 * own rows.
 */
function fakeSupabase(rows: Record<string, unknown[]>, rpcs: Record<string, unknown[]>) {
  return {
    rpc: async (name: string) => ({ data: rpcs[name] ?? [], error: null }),
    from: (table: string) => {
      let limit = Infinity;
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "or", "is", "not", "order", "lt"]) query[method] = () => query;
      query.limit = (n: number) => { limit = n; return query; };
      query.then = (resolve: (value: unknown) => void) => resolve({ data: (rows[table] ?? []).slice(0, limit), error: null });
      return query;
    },
  } as unknown as Parameters<typeof loadInbox>[0];
}

describe("R-directcontact: listing enquiries are deals in the inbox and the thread", () => {
  it("files each topic under the other person, once per listing, newest first", () => {
    const byPerson = enquiriesByPerson(
      [topic({ listing_id: "part-2", title: "Intake", last_at: "2026-11-07T11:00:00Z" }), topic({ last_at: "2026-11-07T13:00:00Z" }), topic()],
      ME,
      [SELLER],
    );
    expect(byPerson.get(SELLER)).toEqual([
      expect.objectContaining({ listing_id: "part-1", at: "2026-11-07T13:00:00Z", seller_id: SELLER }),
      expect.objectContaining({ listing_id: "part-2", title: "Intake" }),
    ]);
  });

  it("ignores a listing that belongs to neither of them, and people not on the page", () => {
    const byPerson = enquiriesByPerson([topic({ seller_id: "someone-else" }), topic({ other_id: "not-listed" })], ME, [SELLER]);
    expect(byPerson.get(SELLER)).toEqual([]);
    expect(byPerson.has("not-listed")).toBe(false);
  });

  it("shows an enquiry-only conversation's deal in the inbox row", async () => {
    const supabase = fakeSupabase(
      { messages: [{ id: "m1", sender_id: ME, kind: "message" }] },
      {
        list_conversations: [{ id: "c1", counterparty_id: SELLER, last_message_id: "m1", last_message_at: "2026-11-07T12:00:00Z", last_message_preview: "Does it fit?", unread_count: 0, total_count: 1 }],
        my_listing_enquiries: [topic()],
      },
    );
    const inbox = await loadInbox(supabase, ME, { filter: "buying", query: "", page: 1 });
    expect(inbox.rows[0].deals).toEqual([
      expect.objectContaining({ key: "listing:part-1", kind: "listing", side: "buying", label: "You asked about it" }),
    ]);
  });

  it("keeps an old listing as a topic after more than 500 newer messages about another", async () => {
    // 600 newer messages about part-2, then the first one about part-1.
    const newer = Array.from({ length: 600 }, (_, i) => ({
      id: `m${i}`, sender_id: i % 2 ? ME : SELLER, recipient_id: i % 2 ? SELLER : ME, body: "more", kind: "message", attachments: [],
      order_id: null, offer_id: null, listing_id: "part-2", read_at: null, created_at: new Date(Date.UTC(2026, 10, 7, 12, 0, 600 - i)).toISOString(),
    }));
    const oldest = { ...newer[0], id: "first", listing_id: "part-1", created_at: "2026-11-01T09:00:00Z" };
    const supabase = fakeSupabase(
      { messages: [...newer, oldest] },
      { my_listing_enquiries: [topic({ listing_id: "part-2", title: "Intake", last_at: newer[0].created_at }), topic({ last_at: oldest.created_at })] },
    );
    const thread = await loadThread(supabase, ME, { conversationId: "c1", otherId: SELLER, dealKey: null });
    expect(thread.deals.map((d) => d.key)).toEqual(["listing:part-2", "listing:part-1"]);
  });
});
