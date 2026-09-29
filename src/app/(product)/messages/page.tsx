import { redirect } from "next/navigation";

import { EmptyState } from "@/components/ui";
import { loadUnreadMessages } from "@/lib/shell-counts";
import { getPageClient, getViewer } from "@/lib/supabase/page-context";

import { InboxPane, parseInboxParams } from "./inbox-pane";

export const metadata = { title: "Messages - DRVN" };

/**
 * The inbox. One row per PERSON (20260928140000): everything you and Kaito
 * have said about the seats you sold him and the wheels he's shipping you is
 * one conversation, with each deal as a chip. On desktop the list sits beside
 * an open conversation; here, with none open, the right pane invites a pick.
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string }>;
}) {
  const params = parseInboxParams(await searchParams);
  const supabase = await getPageClient();
  const user = await getViewer();
  if (!user) redirect("/login");

  const unreadPeople = await loadUnreadMessages(supabase, user.id);

  return (
    <div className="wrap pb-6">
      <div className="msgsplit msgsplit--inbox">
        <aside className="msgsplit__list">
          <InboxPane supabase={supabase} me={user.id} params={params} unreadPeople={unreadPeople} />
        </aside>
        <section className="msgsplit__pane" aria-label="Conversation">
          <div className="msgsplit__empty">
            <EmptyState mark="↔" title="Pick someone to talk to">
              Each conversation is one person — every order and offer between you, in one place.
            </EmptyState>
          </div>
        </section>
      </div>
    </div>
  );
}
