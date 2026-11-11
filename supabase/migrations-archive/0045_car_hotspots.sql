-- 0045 — the annotated showcase image (brief §U).
--
-- An OPTIONAL advanced car-profile feature: the owner picks ONE showcase
-- photo and pins hotspots on it, each referencing a real build entry
-- (mod_items) with a label snapshot so the story survives edits. Explicitly
-- NOT a post block, not on every photo, and capped hard — the default photo
-- experience stays clean.
--
-- Idempotent. Safe to re-run.

begin;

create table if not exists public.car_hotspots (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references public.cars (id) on delete cascade,
  image_url text not null,
  x numeric(4,3) not null check (x >= 0 and x <= 1),
  y numeric(4,3) not null check (y >= 0 and y <= 1),
  mod_item_id uuid references public.mod_items (id) on delete set null,
  label text not null check (char_length(label) between 1 and 80),
  created_at timestamptz not null default now()
);
create index if not exists car_hotspots_car_idx on public.car_hotspots (car_id);

-- One showcase, bounded: at most 8 pins per car (trigger — CHECK can't count).
create or replace function public.guard_hotspot_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.car_hotspots where car_id = new.car_id) >= 8 then
    raise exception 'showcase hotspot limit reached (8)';
  end if;
  return new;
end;
$$;
drop trigger if exists car_hotspots_count_guard on public.car_hotspots;
create trigger car_hotspots_count_guard
  before insert on public.car_hotspots
  for each row execute function public.guard_hotspot_count();

alter table public.car_hotspots enable row level security;
drop policy if exists "hotspots follow car visibility" on public.car_hotspots;
create policy "hotspots follow car visibility" on public.car_hotspots
  for select using (
    exists (
      select 1 from public.cars c
      where c.id = car_id and (c.is_public or c.owner_id = auth.uid())
    )
  );
drop policy if exists "owners manage hotspots" on public.car_hotspots;
create policy "owners manage hotspots" on public.car_hotspots
  for all using (
    exists (select 1 from public.cars c where c.id = car_id and c.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.cars c where c.id = car_id and c.owner_id = auth.uid())
  );

do $$
begin
  if to_regclass('public.car_hotspots') is null then
    raise exception '0045: car_hotspots missing';
  end if;
  raise notice 'PASS: 0045 self-checks';
end $$;

commit;
