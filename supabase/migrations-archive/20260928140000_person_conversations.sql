-- ============================================================================
-- 20260928140000 — One conversation per pair of people
--
-- 0031 materialised a conversation per ORDER and per OFFER (order_id unique,
-- offer_id unique). The inbox therefore listed deals, not people: two members
-- who bought from and sold to each other had one thread per deal, each with
-- its own page and unread dot, and nothing showed the relationship whole.
--
-- This changes the grain to the pair. A conversation is (participant_a,
-- participant_b) with participant_a < participant_b, unique. Messages keep
-- order_id / offer_id / listing_id — they are now the message's "about" tag,
-- so an order or offer page can still read just its own slice.
--
-- Who may message whom is unchanged: the 0012 insert policy still requires
-- the sender to be party to the order or offer the message is about. This is
-- not open DMs (PRD §7 keeps those parked).
--
-- Also:
--   * messages.kind ('message' | 'event'): lifecycle notes (dispute, pickup,
--     return) are events, rendered as centred rows rather than as something
--     the person typed. Only trusted writers may insert events; client inserts
--     are forced to 'message'. Events never count as unread.
--   * messages.attachments: up to four private photo paths in the
--     `message-photos` bucket, `<sender>/<recipient>/<file>`.
--   * messages no longer create bell notifications. The Messages badge (people
--     waiting) is the one signal; old unread message notifications are marked
--     read so the bell stops counting chat.
--   * list_conversations(): the inbox query — filter (all/unread/buying/
--     selling), search, pagination and unread counts in one call.
--   * seller_open_question_list(): the seller's unanswered listing questions.
--   * messages + conversation_unreads join the supabase_realtime publication
--     so an open thread and the rail badge update live (RLS still applies).
--
-- Idempotent: the merge runs only while the old per-deal columns exist; every
-- other statement is create-or-replace / if-not-exists / convergent.
-- ============================================================================

begin;

-- ============================================================
-- 1. messages — kind + attachments
-- ============================================================

alter table public.messages add column if not exists kind text not null default 'message';
alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check check (kind in ('message', 'event'));

alter table public.messages add column if not exists attachments text[] not null default '{}';
alter table public.messages drop constraint if exists messages_attachments_check;
alter table public.messages add constraint messages_attachments_check check (cardinality(attachments) <= 4);

-- A photo-only message is allowed; an empty one is not.
alter table public.messages drop constraint if exists messages_has_words;
alter table public.messages add constraint messages_has_words
  check (char_length(btrim(body)) > 0 or cardinality(attachments) > 0);

-- Lifecycle notes written before `kind` existed. These are the exact bodies the
-- server helpers (order-thread.ts / order-system-message.ts) write.
update public.messages
set kind = 'event'
where kind = 'message'
  and order_id is not null
  and (
    body like 'Offered a refund of %'
    or body like 'Accepted the % refund. Dispute closed.'
    or body = 'Closed the dispute — resolved, no action needed.'
    or body like 'Asked DRVN to step in%'
    or body like 'Opened a dispute — %'
    or body like 'Ready for pickup — %'
    or body = 'Pickup confirmed — handoff complete.'
    or body like 'Requested a return under%'
    or body like 'Return approved — %'
    or body = 'Return request declined.'
    or body like 'Return agreed — %'
    or body like 'Return shipped — %'
    or body like 'Return received — %'
    or body = 'Return withdrawn by the buyer.'
    or body like 'Seller reported a problem with the returned item%'
  );

-- Insert guard: clients can only write ordinary messages, and attachments must
-- sit in the sender's own folder for this recipient (the storage read policy
-- below keys off the same two folder names).
create or replace function public.guard_message_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_path text;
begin
  if not public.is_trusted_writer() then
    new.kind := 'message';
  end if;

  foreach v_path in array coalesce(new.attachments, '{}'::text[]) loop
    if v_path is null
       or position(new.sender_id::text || '/' || new.recipient_id::text || '/' in v_path) <> 1
       or v_path like '%..%'
       or v_path ~ '/[^/]*/[^/]*/' then
      raise exception 'attachments must be in the sender''s folder for this recipient'
        using errcode = '22023';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists messages_guard_insert on public.messages;
create trigger messages_guard_insert
  before insert on public.messages
  for each row execute function public.guard_message_insert();

-- Update guard (0031's, extended to the new columns).
create or replace function public.guard_message_columns()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;

  if new.body is distinct from old.body
     or new.sender_id is distinct from old.sender_id
     or new.recipient_id is distinct from old.recipient_id
     or new.listing_id is distinct from old.listing_id
     or new.offer_id is distinct from old.offer_id
     or new.order_id is distinct from old.order_id
     or new.conversation_id is distinct from old.conversation_id
     or new.kind is distinct from old.kind
     or new.attachments is distinct from old.attachments then
    raise exception 'only read_at may be updated on a message'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ============================================================
-- 2. conversations — merge per-deal rows into one row per pair
-- ============================================================

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'conversations' and column_name = 'type'
  ) then
    create temporary table conversation_merge on commit drop as
    select
      c.id as old_id,
      first_value(c.id) over (
        partition by least(c.participant_a, c.participant_b), greatest(c.participant_a, c.participant_b)
        order by c.last_message_at desc nulls last, c.created_at desc, c.id
      ) as new_id
    from public.conversations c;

    update public.messages m
    set conversation_id = cm.new_id
    from conversation_merge cm
    where m.conversation_id = cm.old_id
      and cm.old_id <> cm.new_id;

    delete from public.conversations c
    using conversation_merge cm
    where c.id = cm.old_id
      and cm.old_id <> cm.new_id;

    update public.conversations
    set participant_a = participant_b,
        participant_b = participant_a
    where participant_a > participant_b;

    alter table public.conversations drop constraint if exists conversations_type_ref;
    alter table public.conversations drop column if exists type;
    alter table public.conversations drop column if exists order_id;
    alter table public.conversations drop column if exists offer_id;
    alter table public.conversations drop column if exists listing_id;
  end if;
end $$;

alter table public.conversations drop constraint if exists conversations_pair_order;
alter table public.conversations add constraint conversations_pair_order check (participant_a < participant_b);
create unique index if not exists conversations_pair_key
  on public.conversations (participant_a, participant_b);

-- Any order/offer message that somehow missed a conversation gets one.
insert into public.conversations (participant_a, participant_b)
select distinct least(m.sender_id, m.recipient_id), greatest(m.sender_id, m.recipient_id)
from public.messages m
where m.conversation_id is null
  and (m.order_id is not null or m.offer_id is not null)
  and m.sender_id <> m.recipient_id
on conflict (participant_a, participant_b) do nothing;

update public.messages m
set conversation_id = c.id
from public.conversations c
where m.conversation_id is null
  and (m.order_id is not null or m.offer_id is not null)
  and c.participant_a = least(m.sender_id, m.recipient_id)
  and c.participant_b = greatest(m.sender_id, m.recipient_id);

-- Last word, recomputed (convergent).
update public.conversations c
set last_message_id = latest.id,
    last_message_at = latest.created_at,
    last_message_preview = latest.preview
from (
  select distinct on (conversation_id)
    conversation_id, id, created_at,
    left(case when char_length(btrim(body)) = 0 then 'Photo' else body end, 140) as preview
  from public.messages
  where conversation_id is not null
  order by conversation_id, created_at desc, id desc
) latest
where latest.conversation_id = c.id;

-- Unread counters, rebuilt from the truth (events never count).
delete from public.conversation_unreads;
insert into public.conversation_unreads (conversation_id, user_id, unread_count)
select m.conversation_id, m.recipient_id, count(*)
from public.messages m
where m.conversation_id is not null
  and m.read_at is null
  and m.kind = 'message'
group by m.conversation_id, m.recipient_id;

-- ============================================================
-- 3. Triggers — messages drive pair conversations
-- ============================================================

create or replace function public.message_attach_conversation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conversation_id uuid;
  v_lo uuid := least(new.sender_id, new.recipient_id);
  v_hi uuid := greatest(new.sender_id, new.recipient_id);
begin
  -- Listing-only context (legacy shape) has no thread surface; leave it
  -- unattached. Every current write path sets an order or an offer.
  if new.order_id is null and new.offer_id is null then
    return new;
  end if;

  insert into public.conversations (participant_a, participant_b)
  values (v_lo, v_hi)
  on conflict (participant_a, participant_b) do nothing;

  select id into v_conversation_id
  from public.conversations
  where participant_a = v_lo and participant_b = v_hi;

  new.conversation_id := v_conversation_id;
  return new;
end;
$$;

create or replace function public.message_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.conversation_id is null then
    return new;
  end if;

  update public.conversations
  set last_message_id = new.id,
      last_message_at = new.created_at,
      last_message_preview = left(case when char_length(btrim(new.body)) = 0 then 'Photo' else new.body end, 140)
  where id = new.conversation_id;

  if new.read_at is null and new.kind = 'message' then
    insert into public.conversation_unreads (conversation_id, user_id, unread_count)
    values (new.conversation_id, new.recipient_id, 1)
    on conflict (conversation_id, user_id)
    do update set unread_count = public.conversation_unreads.unread_count + 1;
  end if;

  return new;
end;
$$;

create or replace function public.message_read_decrement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.conversation_id is not null
     and new.kind = 'message'
     and old.read_at is null
     and new.read_at is not null then
    update public.conversation_unreads
    set unread_count = greatest(unread_count - 1, 0)
    where conversation_id = new.conversation_id
      and user_id = new.recipient_id;
  end if;
  return new;
end;
$$;

-- A removed message (moderation, account deletion) must not linger as the
-- inbox preview or as an unread count.
create or replace function public.message_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.conversation_id is null then
    return old;
  end if;

  if old.read_at is null and old.kind = 'message' then
    update public.conversation_unreads
    set unread_count = greatest(unread_count - 1, 0)
    where conversation_id = old.conversation_id
      and user_id = old.recipient_id;
  end if;

  update public.conversations c
  set last_message_id = latest.id,
      last_message_at = latest.created_at,
      last_message_preview = latest.preview
  from (
    select null::uuid as id, null::timestamptz as created_at, null::text as preview
    where not exists (select 1 from public.messages where conversation_id = old.conversation_id)
    union all
    (select m.id, m.created_at,
            left(case when char_length(btrim(m.body)) = 0 then 'Photo' else m.body end, 140)
     from public.messages m
     where m.conversation_id = old.conversation_id
     order by m.created_at desc, m.id desc
     limit 1)
  ) latest
  where c.id = old.conversation_id
    and c.last_message_id = old.id;

  return old;
end;
$$;

drop trigger if exists messages_after_delete on public.messages;
create trigger messages_after_delete
  after delete on public.messages
  for each row execute function public.message_after_delete();

-- Messages leave the bell. Chat has its own badge; the bell is for things
-- that happened (a sale, a dispute, a follow).
drop trigger if exists messages_notify on public.messages;
update public.notifications set read_at = now() where kind = 'message' and read_at is null;

-- ============================================================
-- 4. Inbox query
-- ============================================================

create or replace function public.list_conversations(
  p_filter text default 'all',
  p_query text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  counterparty_id uuid,
  last_message_id uuid,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count int,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with mine as (
    select
      c.id, c.last_message_id, c.last_message_at, c.last_message_preview,
      case when c.participant_a = auth.uid() then c.participant_b else c.participant_a end as other
    from public.conversations c
    where auth.uid() in (c.participant_a, c.participant_b)
  ),
  scored as (
    select m.*, coalesce(u.unread_count, 0) as unread
    from mine m
    left join public.conversation_unreads u
      on u.conversation_id = m.id and u.user_id = auth.uid()
  ),
  filtered as (
    select s.*
    from scored s
    where (
      coalesce(p_filter, 'all') = 'all'
      or (p_filter = 'unread' and s.unread > 0)
      or (p_filter = 'buying' and (
        exists (select 1 from public.orders o where o.buyer_id = auth.uid() and o.seller_id = s.other)
        or exists (
          select 1 from public.offers f join public.listings l on l.id = f.listing_id
          where f.buyer_id = auth.uid() and l.seller_id = s.other
        )
      ))
      or (p_filter = 'selling' and (
        exists (select 1 from public.orders o where o.seller_id = auth.uid() and o.buyer_id = s.other)
        or exists (
          select 1 from public.offers f join public.listings l on l.id = f.listing_id
          where l.seller_id = auth.uid() and f.buyer_id = s.other
        )
      ))
    )
    and (
      nullif(btrim(coalesce(p_query, '')), '') is null
      or s.last_message_preview ilike '%' || btrim(p_query) || '%'
      or exists (
        select 1 from public.profiles p
        where p.id = s.other
          and (p.display_name ilike '%' || btrim(p_query) || '%' or p.username ilike '%' || btrim(p_query) || '%')
      )
      or exists (
        select 1 from public.messages mm
        where mm.conversation_id = s.id and mm.body ilike '%' || btrim(p_query) || '%'
      )
      or exists (
        select 1 from public.messages mm
        join public.listings l on l.id = mm.listing_id
        where mm.conversation_id = s.id and l.title ilike '%' || btrim(p_query) || '%'
      )
    )
  )
  select f.id, f.other, f.last_message_id, f.last_message_at, f.last_message_preview,
         f.unread::int, count(*) over ()
  from filtered f
  order by f.last_message_at desc nulls last, f.id
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_conversations(text, text, int, int) from public, anon;
grant execute on function public.list_conversations(text, text, int, int) to authenticated;

create or replace function public.seller_open_question_list(p_limit int default 5)
returns table (id uuid, listing_id uuid, listing_title text, body text, created_at timestamptz)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select q.id, q.listing_id, l.title, q.body, q.created_at
  from public.listing_questions q
  join public.listings l on l.id = q.listing_id
  where l.seller_id = auth.uid()
    and q.parent_id is null
    and not exists (select 1 from public.listing_questions a where a.parent_id = q.id)
  order by q.created_at desc
  limit least(greatest(coalesce(p_limit, 5), 1), 20);
$$;

revoke all on function public.seller_open_question_list(int) from public, anon;
grant execute on function public.seller_open_question_list(int) to authenticated;

-- ============================================================
-- 5. Storage — private message photos
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-photos', 'message-photos', false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Paths are `<sender>/<recipient>/<file>`: the sender uploads into their own
-- folder; the two people named in the path (and admins) can read.
drop policy if exists "upload own message photos" on storage.objects;
create policy "upload own message photos" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "read message photos" on storage.objects;
create policy "read message photos" on storage.objects for select
  using (
    bucket_id = 'message-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (storage.foldername(name))[2] = auth.uid()::text
      or public.is_admin()
    )
  );

drop policy if exists "delete own message photos" on storage.objects;
create policy "delete own message photos" on storage.objects for delete to authenticated
  using (
    bucket_id = 'message-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- 6. Realtime
-- ============================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
    ) then
      alter publication supabase_realtime add table public.messages;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_unreads'
    ) then
      alter publication supabase_realtime add table public.conversation_unreads;
    end if;
  end if;
end $$;

-- ============================================================
-- Self-checks
-- ============================================================
do $$
declare
  v_count int;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'conversations'
      and column_name in ('type', 'order_id', 'offer_id', 'listing_id')
  ) then
    raise exception 'SELF-CHECK FAILED: per-deal columns still on conversations';
  end if;

  select count(*) into v_count
  from (
    select participant_a, participant_b from public.conversations
    group by 1, 2 having count(*) > 1
  ) d;
  if v_count > 0 then
    raise exception 'SELF-CHECK FAILED: % duplicate conversation pairs', v_count;
  end if;

  select count(*) into v_count
  from public.messages
  where conversation_id is null and (order_id is not null or offer_id is not null);
  if v_count > 0 then
    raise exception 'SELF-CHECK FAILED: % order/offer messages unattached', v_count;
  end if;

  select count(*) into v_count
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where not (c.participant_a = least(m.sender_id, m.recipient_id)
         and c.participant_b = greatest(m.sender_id, m.recipient_id));
  if v_count > 0 then
    raise exception 'SELF-CHECK FAILED: % messages in the wrong pair conversation', v_count;
  end if;

  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.messages'::regclass and tgname = 'messages_notify'
  ) then
    raise exception 'SELF-CHECK FAILED: messages still notify the bell';
  end if;

  raise notice 'PASS: person conversations self-checks';
end $$;

commit;
