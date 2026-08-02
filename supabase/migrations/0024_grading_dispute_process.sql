-- ============================================================================
-- 0024 — Condition grading, dispute evidence, escalation & outcomes
--
-- The eBay-shaped dispute skeleton (claim window / seller-first / escalate /
-- consequences), plus the listing-side half that prevents disputes in the
-- first place: a defined letter grade and a per-category condition checklist
-- that together make the listing an explicit contract.
--
--  * listings.grade + listings.condition_checklist — seller-declared, shown
--    at point of sale. The checklist catalog lives in code
--    (src/lib/marketplace/grading.ts); the column stores the answers.
--  * order_items.condition_snapshot — the contract frozen at purchase time,
--    filled by trigger from the listing row so every order-creation path
--    (cart claim, buy-now, offer accept — all SQL functions) gets it without
--    each being re-declared here.
--  * dispute_evidence — photos both parties attach to a dispute; the missing
--    half of "not as described" adjudication.
--  * orders.dispute_escalated_at — the buyer's explicit "ask DRVN to step
--    in", available after the seller-response window. Surfaces in the admin
--    queue ahead of the day-4 SLA sweep.
--  * orders.dispute_outcome — how a dispute actually ended, stamped by the
--    resolution paths. Seller defects = count of outcomes that cost the
--    buyer's money back; computed, never a counter that can drift.
--
-- The 30-day claim window needs no schema: openDispute enforces it against
-- orders.delivered_at (0007).
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ============================================================
-- listings — grade + checklist answers
-- ============================================================
alter table public.listings
  add column if not exists grade text,
  add column if not exists condition_checklist jsonb;

alter table public.listings
  drop constraint if exists listings_grade_check;
alter table public.listings
  add constraint listings_grade_check check (grade is null or grade in ('a', 'b', 'c'));

-- Answers are a flat {question_key: 'yes'|'no'|'unknown'} object.
alter table public.listings
  drop constraint if exists listings_condition_checklist_shape;
alter table public.listings
  add constraint listings_condition_checklist_shape check (
    condition_checklist is null or jsonb_typeof(condition_checklist) = 'object'
  );

-- ============================================================
-- order_items — the contract, frozen at purchase
-- ============================================================
alter table public.order_items
  add column if not exists condition_snapshot jsonb;

-- Every order-creation path inserts order_items rows from inside a SQL
-- function (0007 cart claim, 0012 offer accept), so the snapshot is taken by
-- trigger rather than re-declaring each function. NULL listing_id (removed
-- listing) simply stays NULL.
create or replace function public.snapshot_order_item_condition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.listing_id is not null and new.condition_snapshot is null then
    select jsonb_strip_nulls(
             jsonb_build_object(
               'condition', l.condition,
               'grade', l.grade,
               'checklist', l.condition_checklist,
               'compatibility_notes', l.compatibility_notes
             )
           )
      into new.condition_snapshot
      from public.listings l
     where l.id = new.listing_id;
  end if;
  return new;
end;
$$;

drop trigger if exists order_items_condition_snapshot on public.order_items;
create trigger order_items_condition_snapshot
  before insert on public.order_items
  for each row execute function public.snapshot_order_item_condition();

-- ============================================================
-- orders — escalation + outcome
-- ============================================================
alter table public.orders
  add column if not exists dispute_escalated_at timestamptz,
  add column if not exists dispute_outcome text;

alter table public.orders
  drop constraint if exists orders_dispute_outcome_check;
alter table public.orders
  add constraint orders_dispute_outcome_check check (
    dispute_outcome is null or dispute_outcome in (
      'refund_accepted',   -- buyer accepted the seller's offer
      'closed_by_buyer',   -- buyer closed it, no money moved
      'auto_refunded',     -- day-10 SLA sweep refunded an ignored dispute
      'admin_refunded',    -- an admin forced the refund
      'admin_resolved',    -- an admin resolved without refund
      'chargeback_lost'    -- the card network decided it for us
    )
  );

-- The admin queue sorts escalated disputes ahead of quiet ones.
create index if not exists orders_dispute_escalated_idx
  on public.orders (dispute_escalated_at)
  where status = 'disputed';

-- Seller-defect lookups: "how many disputes has this seller lost money on".
create index if not exists orders_dispute_outcome_seller_idx
  on public.orders (seller_id, dispute_outcome)
  where dispute_outcome is not null;

-- ============================================================
-- dispute_evidence — photos from either party
-- ============================================================
create table if not exists public.dispute_evidence (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  uploader_id uuid references public.profiles (id) on delete set null,
  url text not null,
  note text,
  created_at timestamptz not null default now(),
  constraint dispute_evidence_note_bounds check (note is null or char_length(note) <= 500)
);

create index if not exists dispute_evidence_order_idx on public.dispute_evidence (order_id);

alter table public.dispute_evidence enable row level security;

-- Reads: the order's participants. Writes go through server actions on the
-- service-role client (the same enforcement pattern as every other order
-- transition), so no user-facing insert/update/delete policies exist.
drop policy if exists "participants read dispute evidence" on public.dispute_evidence;
create policy "participants read dispute evidence" on public.dispute_evidence for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and auth.uid() in (o.buyer_id, o.seller_id)
    )
  );

-- ============================================================
-- Storage — the dispute-evidence bucket
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dispute-evidence', 'dispute-evidence', true,
  10485760, -- 10 MB, same ceiling as listing photos
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Mirrors the 0001 media policies: public read, uploads only into the
-- uploader's own uid-named folder.
drop policy if exists "public read dispute evidence" on storage.objects;
create policy "public read dispute evidence" on storage.objects for select
  using (bucket_id = 'dispute-evidence');

drop policy if exists "users upload dispute evidence" on storage.objects;
create policy "users upload dispute evidence" on storage.objects for insert
  with check (
    bucket_id = 'dispute-evidence'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users delete own dispute evidence" on storage.objects;
create policy "users delete own dispute evidence" on storage.objects for delete
  using (
    bucket_id = 'dispute-evidence'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;
