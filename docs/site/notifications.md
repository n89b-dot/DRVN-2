# Notifications

> The notification domain: every kind, its governing preference, and the one
> delivery seam. Code: `src/lib/notifications/`,
> `src/lib/notification-prefs.ts`, migration 0009 onward.

## Shape

One table (`notifications`: kind, section, title, body, href, actor, read_at)
renders generically on `/notifications` (two sections, unread filter,
per-item read-on-open). Opening an order also marks the notifications that
point at it read (`markNotificationsReadForPage` in
`src/lib/notifications-read.ts`), so the bell stops counting what the member
has already dealt with. The bell badge, the "N unread" line and the list all
use one rule, `kindIsShown()`: a kind the member switched off in Settings is
neither shown nor counted. Reactive kinds are written by SECURITY DEFINER
database triggers; app-raised kinds (worker alerts) go through
`deliverNotification()` — the delivery boundary — which checks the governing
preference **at write time** and is the documented seam where future channels
(email, push, or a provider like Novu) would fan out.

**Novu decision (2026-08):** evaluated, not adopted. One in-app channel needs
no workflow orchestration, and DRVN must not depend on a hosted notification
service to function. The seam is `deliver.ts`; revisit when channels
actually multiply.

## Where a notification points

Three trigger functions — `notify_on_save`, `notify_on_activity_comment`,
`notify_on_activity_reaction` — used to build a post's permalink by hand as
`'/cars/' || c.slug || '/activity/' || p.id`, joining `cars` INNER to get the
slug. When `activity_posts.car_id` became nullable (W-5), that join found no
row for a carless post: the owner variable stayed null, the branch that sends
the notification never ran, and the save, comment or reaction **worked while
the author was never told**. A silent nothing is the worst failure mode a
notification can have.

All three now call `public.post_href(post_id)` (migration 198000), the SQL
twin of `postHref()` in `src/lib/activity/href.ts`. One function, two
languages, one answer: `/cars/{slug}/activity/{id}` with a car,
`/posts/{id}` without. `supabase/tests/carless_post_reach_guard.sql` asserts
that a save, a comment and a reaction on a carless post each reach the author
at that URL, and that no notification anywhere holds a `/cars//activity/`
href.

## Adding a kind

1. Register it in `NOTIFICATION_KINDS` (`src/lib/notifications/kinds.ts`) —
   section, governing preference, source. A unit test keeps this registry and
   `prefKeyForKind` agreeing.
2. If preference-governed, ensure the pref key exists in
   `NOTIFICATION_PREFS`.
3. Write it: a trigger migration for reactive kinds, or
   `deliverNotification()` from app code.
4. Regenerate this page's table: `npm run docs:systems`.

## Alert etiquette (brief §C/§D)

Non-transactional alerts (saved searches) are **opt-in only**: saving is
silent; alerts are a separate explicit toggle; the worker raises at most one
summary notification per search per pass; the first pass after opt-in only
stamps a baseline so nobody is alerted about inventory that predates it.

## The kinds

<!-- BEGIN GENERATED: notification-kinds (npm run docs:systems) -->

Source of truth: `src/lib/notifications/kinds.ts`.

| Kind | Section | Preference | Written by | What it means |
| --- | --- | --- | --- | --- |
| `follow` | engagement | `profile_follows` | DB trigger | Someone followed your profile. |
| `save` | engagement | `car_engagement` | DB trigger | Someone saved your car, profile or post. |
| `comment` | engagement | `comments` | DB trigger | A comment on your build update. |
| `reaction` | engagement | `comments` | DB trigger | A reaction on your build update. |
| `review` | engagement | `reviews` | DB trigger | A review after a completed trade. |
| `listing_save` | marketplace | `listing_saves` | DB trigger | Someone saved your listing. |
| `question` | marketplace | `questions` | DB trigger | A question on one of your parts. |
| `offer_new` | marketplace | `offers_sales` | DB trigger | A new offer on your listing. |
| `offer_response` | marketplace | `offers_sales` | DB trigger | Your offer was answered. |
| `offer_withdrawn` | marketplace | `offers_sales` | DB trigger | An offer was withdrawn. |
| `order_sold` | marketplace | `offers_sales` | DB trigger | Your part sold. |
| `order_paid` | marketplace | `offers_sales` | DB trigger | Payment confirmed on an order. |
| `order_shipped` | marketplace | `order_updates` | DB trigger | Your order shipped. |
| `order_delivered` | marketplace | `order_updates` | DB trigger | Delivery confirmed. |
| `order_disputed` | marketplace | `order_updates` | DB trigger | A dispute opened on an order. |
| `dispute_resolved` | marketplace | `order_updates` | DB trigger | A dispute was resolved. |
| `dispute_escalated` | marketplace | `order_updates` | DB trigger | A dispute was escalated to support. |
| `message` | marketplace | `messages` | DB trigger | A message on an offer or order thread. |
| `saved_search` | marketplace | `saved_searches` | app (deliver.ts) | New inventory matching a saved search with alerts on. |

<!-- END GENERATED: notification-kinds -->

**Offers and follows** (`20260928160000`):

- Every offer notification opens the offer, `/offers/<id>` — they used to
  point at `/orders`. The trigger writes `offer_new` (to the seller),
  `offer_countered` and `offer_declined` (to the buyer) and `offer_withdrawn`
  (to the seller).
- A seller's acceptance is announced once, by the app (`offer_accepted`,
  linking to the checkout the buyer now needs); the trigger no longer adds a
  second "Your offer was accepted".
- A buyer taking the seller's counter tells the **seller**
  (`offer_counter_accepted`, "Your counter was accepted", linking to the order
  it created). Before, it told the buyer and not the seller.
- Following a car is `car_follow`, governed by "Car follows & saves"
  (`car_engagement`); `follow` is profile follows only. Existing car-follow
  rows were moved over. Before, "New followers" muted both and the car
  switch muted neither.

The generated table above comes from `NOTIFICATION_KINDS` and does not yet
list `car_follow` or the per-outcome offer kinds; `prefKeyForKind` already
maps them.
