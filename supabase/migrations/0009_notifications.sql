-- ============================================================================
-- 0009 — Notifications (remediation plan R7.3)
--
-- Notifications were derived at read time from `follows` and `saves`, which
-- covered 4 of the ~12 events the PRD specifies and could not represent
-- anything commerce-related. Sellers were never told a question had been
-- asked, so listing Q&A went unanswered; the "offers and sales land here too"
-- empty state was simply false; and there was no unread state, so a follow from
-- six months ago still read as new.
--
-- Events are raised by triggers rather than from server actions, so coverage
-- doesn't depend on which code path performed the write — including the
-- service-role paths in checkout.
--
-- Idempotent: safe to re-run.
-- Run in the Supabase SQL Editor.
-- ============================================================================

begin;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  -- The PRD keeps these two streams deliberately separate so the product never
  -- feels like it's only about offloading parts.
  section text not null check (section in ('engagement', 'marketplace')),
  title text not null,
  body text,
  href text,
  actor_id uuid references public.profiles (id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

create policy "users read own notifications" on public.notifications for select
  using (auth.uid() = user_id);
create policy "users update own notifications" on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "users delete own notifications" on public.notifications for delete
  using (auth.uid() = user_id);
-- Inserts come from triggers (security definer) only.

-- ============================================================
-- Helper
-- ============================================================
create or replace function public.notify(
  p_user_id uuid,
  p_kind text,
  p_section text,
  p_title text,
  p_body text default null,
  p_href text default null,
  p_actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Never notify someone about their own action.
  if p_user_id is null or p_user_id = p_actor_id then
    return;
  end if;

  insert into public.notifications (user_id, kind, section, title, body, href, actor_id)
  values (p_user_id, p_kind, p_section, p_title, p_body, p_href, p_actor_id);
end;
$$;

create or replace function public.actor_name(p_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(display_name, '@' || username, 'Someone') from public.profiles where id = p_id;
$$;

-- ============================================================
-- Engagement events
-- ============================================================
create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_href text;
  v_title text;
begin
  if new.target_type = 'profile' then
    v_owner := new.target_id;
    v_title := public.actor_name(new.follower_id) || ' followed you';
    select '/u/' || username into v_href from public.profiles where id = new.follower_id;
  else
    select c.owner_id, '/cars/' || c.slug into v_owner, v_href
    from public.cars c where c.id = new.target_id;
    v_title := public.actor_name(new.follower_id) || ' is following your build';
  end if;

  perform public.notify(
    v_owner, 'follow', 'engagement', v_title, null, v_href, new.follower_id
  );
  return new;
end;
$$;

drop trigger if exists follows_notify on public.follows;
create trigger follows_notify after insert on public.follows
  for each row execute function public.notify_on_follow();

create or replace function public.notify_on_save()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_href text;
  v_title text;
begin
  if new.target_type = 'car' then
    select c.owner_id, '/cars/' || c.slug into v_owner, v_href
    from public.cars c where c.id = new.target_id;
    v_title := public.actor_name(new.user_id) || ' saved your build';
  elsif new.target_type = 'listing' then
    select l.seller_id, '/listings/' || l.id into v_owner, v_href
    from public.listings l where l.id = new.target_id;
    v_title := public.actor_name(new.user_id) || ' saved your part';
  else
    v_owner := new.target_id;
    v_title := public.actor_name(new.user_id) || ' saved your profile';
    select '/u/' || username into v_href from public.profiles where id = new.user_id;
  end if;

  perform public.notify(v_owner, 'save', 'engagement', v_title, null, v_href, new.user_id);
  return new;
end;
$$;

drop trigger if exists saves_notify on public.saves;
create trigger saves_notify after insert on public.saves
  for each row execute function public.notify_on_save();

create or replace function public.notify_on_activity_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
  v_href text;
begin
  select p.author_id, '/cars/' || c.slug || '/activity/' || p.id
  into v_author, v_href
  from public.activity_posts p
  join public.cars c on c.id = p.car_id
  where p.id = new.post_id;

  perform public.notify(
    v_author, 'comment', 'engagement',
    public.actor_name(new.author_id) || ' commented on your update',
    left(new.body, 140), v_href, new.author_id
  );
  return new;
end;
$$;

drop trigger if exists activity_comments_notify on public.activity_comments;
create trigger activity_comments_notify after insert on public.activity_comments
  for each row execute function public.notify_on_activity_comment();

create or replace function public.notify_on_activity_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
  v_href text;
begin
  select p.author_id, '/cars/' || c.slug || '/activity/' || p.id
  into v_author, v_href
  from public.activity_posts p
  join public.cars c on c.id = p.car_id
  where p.id = new.post_id;

  perform public.notify(
    v_author, 'reaction', 'engagement',
    public.actor_name(new.user_id) || ' reacted ' || new.emoji,
    null, v_href, new.user_id
  );
  return new;
end;
$$;

drop trigger if exists activity_reactions_notify on public.activity_reactions;
create trigger activity_reactions_notify after insert on public.activity_reactions
  for each row execute function public.notify_on_activity_reaction();

create or replace function public.notify_on_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify(
    new.reviewee_id, 'review', 'engagement',
    public.actor_name(new.reviewer_id) || ' left you a ' || new.rating || '-star review',
    left(coalesce(new.body, ''), 140), '/orders/' || new.order_id, new.reviewer_id
  );
  return new;
end;
$$;

drop trigger if exists reviews_notify on public.reviews;
create trigger reviews_notify after insert on public.reviews
  for each row execute function public.notify_on_review();

-- ============================================================
-- Marketplace events
-- ============================================================
create or replace function public.notify_on_question()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid;
  v_title text;
begin
  select l.seller_id into v_seller from public.listings l where l.id = new.listing_id;

  -- A reply notifies the person being replied to; a new question notifies the
  -- seller. Without this, sellers never learned a question had been asked.
  if new.parent_id is not null then
    select q.author_id into v_seller
    from public.listing_questions q where q.id = new.parent_id;
    v_title := public.actor_name(new.author_id) || ' answered your question';
  else
    v_title := public.actor_name(new.author_id) || ' asked about your part';
  end if;

  perform public.notify(
    v_seller, 'question', 'marketplace', v_title,
    left(new.body, 140), '/listings/' || new.listing_id, new.author_id
  );
  return new;
end;
$$;

drop trigger if exists listing_questions_notify on public.listing_questions;
create trigger listing_questions_notify after insert on public.listing_questions
  for each row execute function public.notify_on_question();

create or replace function public.notify_on_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid;
  v_title text;
begin
  select l.seller_id, l.title into v_seller, v_title
  from public.listings l where l.id = new.listing_id;

  perform public.notify(
    v_seller, 'offer_new', 'marketplace',
    'New offer on ' || v_title,
    to_char(new.amount_cents / 100.0, 'FM999,999,990.00'),
    '/orders', new.buyer_id
  );
  return new;
end;
$$;

drop trigger if exists offers_notify_new on public.offers;
create trigger offers_notify_new after insert on public.offers
  for each row execute function public.notify_on_offer();

create or replace function public.notify_on_offer_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid;
  v_listing_title text;
begin
  if new.status = old.status then
    return new;
  end if;

  select l.seller_id, l.title into v_seller, v_listing_title
  from public.listings l where l.id = new.listing_id;

  -- Buyer-facing outcomes.
  if new.status in ('accepted', 'declined', 'countered') then
    perform public.notify(
      new.buyer_id, 'offer_' || new.status, 'marketplace',
      case new.status
        when 'accepted' then 'Your offer was accepted'
        when 'declined' then 'Your offer was declined'
        else 'The seller countered your offer'
      end,
      v_listing_title, '/orders', v_seller
    );
  end if;

  -- Seller-facing: the buyer walked away.
  if new.status = 'withdrawn' then
    perform public.notify(
      v_seller, 'offer_withdrawn', 'marketplace',
      'An offer was withdrawn', v_listing_title, '/orders', new.buyer_id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists offers_notify_response on public.offers;
create trigger offers_notify_response after update on public.offers
  for each row execute function public.notify_on_offer_response();

create or replace function public.notify_on_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status = 'paid' then
    perform public.notify(
      new.seller_id, 'order_sold', 'marketplace',
      'You made a sale',
      'Order ' || left(new.id::text, 8) || ' — dispatch when ready',
      '/orders/' || new.id, new.buyer_id
    );
    perform public.notify(
      new.buyer_id, 'order_paid', 'marketplace',
      'Payment confirmed', 'Your order is with the seller',
      '/orders/' || new.id, new.seller_id
    );
  elsif new.status = 'shipped' then
    perform public.notify(
      new.buyer_id, 'order_shipped', 'marketplace',
      'Your part is on its way',
      coalesce(new.carrier || ' · ' || new.tracking_number, 'Dispatched'),
      '/orders/' || new.id, new.seller_id
    );
  elsif new.status = 'delivered' then
    perform public.notify(
      new.seller_id, 'order_delivered', 'marketplace',
      'Delivery confirmed', 'The buyer marked the order received',
      '/orders/' || new.id, new.buyer_id
    );
  elsif new.status in ('cancelled', 'refunded', 'payment_failed') then
    perform public.notify(
      new.buyer_id, 'order_' || new.status, 'marketplace',
      'Order ' || replace(new.status, '_', ' '),
      coalesce(new.cancel_reason, null), '/orders/' || new.id, null
    );
    perform public.notify(
      new.seller_id, 'order_' || new.status, 'marketplace',
      'Order ' || replace(new.status, '_', ' '),
      coalesce(new.cancel_reason, null), '/orders/' || new.id, null
    );
  end if;

  return new;
end;
$$;

drop trigger if exists orders_notify_status on public.orders;
create trigger orders_notify_status after update on public.orders
  for each row execute function public.notify_on_order_status();

create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_href text;
begin
  v_href := case
    when new.order_id is not null then '/orders/' || new.order_id
    else '/orders'
  end;

  perform public.notify(
    new.recipient_id, 'message', 'marketplace',
    'Message from ' || public.actor_name(new.sender_id),
    left(new.body, 140), v_href, new.sender_id
  );
  return new;
end;
$$;

drop trigger if exists messages_notify on public.messages;
create trigger messages_notify after insert on public.messages
  for each row execute function public.notify_on_message();

commit;
