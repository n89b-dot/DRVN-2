import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DealCard } from "@/components/commerce";
import { Avatar, ButtonLink, Media } from "@/components/ui";
import { loadThread, markConversationRead, resolveThreadTarget } from "@/features/commerce/conversations";
import { defaultDealKey, shortTitle, type Deal } from "@/features/commerce/deals";
import { ReportButton } from "@/features/moderation/report-button";
import { initialsOf } from "@/lib/format";
import { markNotificationsReadForPage } from "@/lib/notifications-read";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { loadUnreadMessages } from "@/lib/shell-counts";
import { getPageClient, getViewer } from "@/lib/supabase/page-context";

import { InboxPane, inboxQuery, parseInboxParams } from "../inbox-pane";
import { ThreadView } from "./thread-view";

export const metadata = { title: "Conversation - DRVN" };

/** How many deals the header shows before the rest live on their pages. */
const STRIP_MAX = 3;

function stripDeals(deals: Deal[]): Deal[] {
  const active = deals.filter((d) => d.active);
  return (active.length ? active : deals.slice(0, 1)).slice(0, STRIP_MAX);
}

function composerLabel(deal: Deal) {
  return `${deal.side === "buying" ? "Buying" : "Selling"} · ${shortTitle(deal.title)} · ${deal.label}`;
}

/**
 * One conversation — one person. `[id]` is the conversation; an order or offer
 * id is also accepted (old links, "Message the seller") and redirects to the
 * person's conversation once one exists, defaulting the reply to that deal.
 *
 * The header names the person and the deals between you; the timeline mixes
 * what was said with what happened (offers, counters, shipping, disputes);
 * a live offer can be decided right where it's being discussed.
 */
export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ before?: string; about?: string; q?: string; filter?: string; page?: string }>;
}) {
  const { id } = await params;
  const raw = await searchParams;
  const inboxParams = parseInboxParams(raw);
  const supabase = await getPageClient();
  const user = await getViewer();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/messages/${id}`)}`);

  const target = await resolveThreadTarget(supabase, user.id, id);
  if (!target) notFound();

  // Opened by order/offer id but the person's conversation exists: land on it,
  // with the reply defaulted to the deal the link was about.
  if (target.conversationId && target.conversationId !== id) {
    redirect(`/messages/${target.conversationId}${inboxQuery(inboxParams, { about: target.dealKey ?? undefined })}`);
  }

  const markRead = target.conversationId ? markConversationRead(supabase, user.id, target.conversationId) : Promise.resolve();
  const [thread] = await Promise.all([loadThread(supabase, user.id, target, raw.before), markRead]);
  const unreadPeople = await loadUnreadMessages(supabase, user.id);

  const { person, deals } = thread;
  const about = raw.about && deals.some((d) => d.key === raw.about) ? raw.about : null;
  const composerDefault = about ?? target.dealKey ?? defaultDealKey(deals, thread.lastMessageDealKey);
  const aboutLabels = Object.fromEntries(deals.map((d) => [d.key, shortTitle(d.title)]));
  const liveOffers = thread.offers
    .filter((f) => deals.some((d) => d.key === `offer:${f.id}` && d.active))
    .map((f) => ({
      id: f.id,
      status: f.status,
      amountCents: f.amount_cents,
      counterAmountCents: f.counter_amount_cents,
      incoming: f.seller_id === user.id,
      title: shortTitle(f.title),
      expiresAt: f.expires_at,
    }));
  // A live offer is decided right here, so its bell notification is dealt
  // with too (as it is on /offers/[id]).
  const seenOffers = new Set(liveOffers.map((o) => `/offers/${o.id}`));
  if (target.dealKey?.startsWith("offer:")) seenOffers.add(`/offers/${target.dealKey.slice(6)}`);
  await markNotificationsReadForPage(supabase, user.id, [...seenOffers]);
  const activeCount = deals.filter((d) => d.active).length;
  const subline = [
    person.username ? `@${person.username}` : null,
    deals.length ? `${deals.length} deal${deals.length === 1 ? "" : "s"} with you${activeCount ? ` · ${activeCount} open` : ""}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="wrap pb-6">
      <div className="msgsplit msgsplit--thread">
        <aside className="msgsplit__list">
          <InboxPane
            supabase={supabase}
            me={user.id}
            params={inboxParams}
            activeId={target.conversationId ?? id}
            unreadPeople={unreadPeople}
          />
        </aside>

        <section className="msgsplit__pane" aria-label={`Conversation with ${person.name}`}>
          <Link href={`/messages${inboxQuery(inboxParams)}`} className="jumplink msgsplit__back">
            ← Messages
          </Link>

          <header className="convhead">
            <span className="convrow__avatar">
              {person.avatar ? (
                <Media src={person.avatar} alt="" className="h-full w-full" role="avatar" />
              ) : (
                <Avatar size="sm" initials={initialsOf(person.name)} />
              )}
            </span>
            <span className="convhead__who">
              <h1 className="convhead__name">{person.name}</h1>
              {subline && <span className="convhead__sub">{subline}</span>}
            </span>
            <span className="convhead__end">
              {person.username && (
                <Link href={`/u/${person.username}`} className="jumplink">
                  Profile
                </Link>
              )}
              <ReportButton
                subjectType="user"
                subjectId={person.id}
                subjectLabel={person.name}
                isLoggedIn
                triggerLabel="Report"
                context={target.conversationId ? `From conversation ${target.conversationId}` : "From messages"}
              />
            </span>
          </header>

          {deals.length > 0 && (
            <div className="dealstrip">
              {stripDeals(deals).map((deal) => (
                <DealCard
                  key={deal.key}
                  href={deal.href}
                  title={deal.title}
                  image={deal.image}
                  tone={deal.tone}
                  eyebrow={`${deal.side === "buying" ? "Buying" : "Selling"} · ${deal.label}`}
                  amount={formatPrice(deal.amountCents)}
                  action={
                    deal.action && deal.kind === "order" ? (
                      <ButtonLink href={deal.action.href} variant={deal.tone === "move" ? "default" : "ghost"}>
                        {deal.action.label}
                      </ButtonLink>
                    ) : undefined
                  }
                />
              ))}
            </div>
          )}

          <ThreadView
            key={target.conversationId ?? id}
            conversationId={target.conversationId}
            me={user.id}
            otherId={person.id}
            otherName={person.firstName}
            messages={thread.messages}
            events={thread.events}
            aboutLabels={aboutLabels}
            liveOffers={liveOffers}
            composerDeals={deals.map((d) => ({ key: d.key, label: composerLabel(d) }))}
            composerDefault={composerDefault}
            hasEarlier={thread.hasEarlier}
            earliest={thread.earliest}
            viewingHistory={Boolean(raw.before)}
            basePath={`/messages/${target.conversationId ?? id}`}
          />
        </section>
      </div>
    </div>
  );
}
