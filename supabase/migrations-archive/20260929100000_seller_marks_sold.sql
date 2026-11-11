-- A seller can mark a part sold when it sold somewhere else.
--
-- guard_listing_status (0012/0018) refused every seller-made change to
-- 'sold' — sold was only ever checkout's outcome — so the "Mark sold" action
-- on My Listings (setListingStatus, which writes as the seller) always failed
-- with "listing status sold is set by checkout". This allows exactly one
-- more move: active or paused → sold, by the seller. Reserved stays
-- checkout-only, a reserved or sold listing still can't be changed, and the
-- public "N sold" trust figure (profile_sales_count) counts paid orders, not
-- listings. Everything else in the function is the live definition, backed up
-- to ~/drvn-db-backups/pre-mark-sold-guard_listing_status.sql.
--
-- Idempotent: create or replace.

begin;

CREATE OR REPLACE FUNCTION public.guard_listing_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
begin
  if public.is_trusted_writer() then
    return new;
  end if;

  if new.status is distinct from old.status then
    -- `reserved` is an outcome of checkout, never a seller's choice. `sold`
    -- is too, with one exception: a seller may mark their own live or paused
    -- part sold when it sold somewhere else ("Mark sold"). The public "N sold"
    -- trust figure counts paid orders, so this can't inflate it.
    if new.status = 'sold' and old.status in ('active', 'paused') then
      null;
    elsif new.status in ('reserved', 'sold') then
      raise exception 'listing status % is set by checkout, not by the seller', new.status
        using errcode = '42501';
    end if;

    -- `removed` is a moderation outcome. Setting it, or un-setting it, is
    -- admin tooling (service role) only.
    if new.status = 'removed' or old.status = 'removed' then
      raise exception 'listing status ''removed'' is set and cleared by moderation'
        using errcode = '42501';
    end if;

    -- A listing held by an in-flight checkout must not be yanked out from
    -- under the buyer. Only the sweeper or a finalize may release it.
    if old.status = 'reserved' then
      raise exception 'listing is reserved by a checkout in progress'
        using errcode = '42501';
    end if;

    -- A sold part stays sold. Relisting means creating a new listing, so the
    -- order history keeps pointing at what was actually bought.
    if old.status = 'sold' then
      raise exception 'a sold listing cannot be relisted — create a new one'
        using errcode = '42501';
    end if;

    -- A suspended seller cannot put anything (back) on the market.
    if new.status = 'active' and public.is_suspended(new.seller_id) then
      raise exception 'account is suspended'
        using errcode = '42501';
    end if;
  end if;

  -- Price and shipping are part of what a buyer agreed to; freeze them while a
  -- checkout holds the row.
  if old.status = 'reserved'
     and (new.price_cents is distinct from old.price_cents
          or new.shipping_cents is distinct from old.shipping_cents) then
    raise exception 'cannot change price while a checkout is in progress'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

commit;
