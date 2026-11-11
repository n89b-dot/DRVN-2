-- Back-fill catalogue ids on cars that predate the vehicle catalogue (or were
-- typed by hand), so the marketplace can offer "Parts for my <car>" and list
-- the garage in the vehicle picker (both need catalog_make_id).
--
-- Make: case-insensitive exact name match.
-- Model: exact name match, else the longest catalogue model whose name the
-- car's model starts with, followed by a space ("M4 Competition" -> "M4",
-- "RS4 Avant" -> "RS4"). No model match leaves the car make-only, which the
-- picker still offers. Only cars without a make id are touched, so this is
-- safe to re-run and never overrides an id a member picked.

update public.cars c
set catalog_make_id = m.id
from public.catalog_makes m
where c.catalog_make_id is null
  and c.make is not null
  and lower(m.name) = lower(trim(c.make));

update public.cars c
set catalog_model_id = (
  select cm.id
  from public.catalog_models cm
  where cm.make_id = c.catalog_make_id
    and (
      lower(cm.name) = lower(trim(c.model))
      or lower(trim(c.model)) like lower(cm.name) || ' %'
    )
  order by (lower(cm.name) = lower(trim(c.model))) desc, length(cm.name) desc
  limit 1
)
where c.catalog_make_id is not null
  and c.catalog_model_id is null
  and c.model is not null
  and trim(c.model) <> '';
