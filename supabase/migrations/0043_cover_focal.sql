-- 0043 — non-destructive cover framing (brief §S3).
--
-- A car's cover renders at many crops (hero, card, garage plate, row thumb).
-- Instead of destructive cropping, the owner picks the point that matters —
-- the car — and every crop keeps it in frame via object-position. The
-- original photo is untouched; this is technical render data, not a
-- user-facing "image metadata" feature.
--
-- Idempotent. Safe to re-run.

begin;

alter table public.cars
  add column if not exists cover_focal_x numeric(4,3)
    check (cover_focal_x is null or (cover_focal_x >= 0 and cover_focal_x <= 1)),
  add column if not exists cover_focal_y numeric(4,3)
    check (cover_focal_y is null or (cover_focal_y >= 0 and cover_focal_y <= 1));

comment on column public.cars.cover_focal_x is
  'Cover framing focal point, 0..1 from the left. Null = center. Render-only (0043).';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'cars' and column_name = 'cover_focal_x'
  ) then
    raise exception '0043: cars.cover_focal_x missing';
  end if;
  raise notice 'PASS: 0043 self-checks';
end $$;

commit;
