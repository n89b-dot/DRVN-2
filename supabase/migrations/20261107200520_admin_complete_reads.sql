-- 20261107200520 — console exports and member filters read everything they
-- say they do (N133, OS-W14).
--
-- PostgREST returns at most 1,000 rows a request (supabase/config.toml
-- max_rows). The finance CSV exports asked for 5,000 and silently got the
-- first 1,000; their name and title lookups sent every id in one URL, which
-- fails on long lists and read as "no name". The Users page built its
-- "Sellers" and "Sellers w/o payouts" filters the same way: 1,000 listing and
-- order rows, then every seller id in one `in (...)`.
--
-- These three read functions do the joins and filters in the database, so
-- nothing depends on a row cap or a URL length:
--   * admin_export_orders: one keyset page (by sort time, then id) of the
--     Orders or Disputes view under the console's filters, with buyer and
--     seller names and the item title joined. The export route pages it
--     until a short page, so the file is complete or the download fails;
--     it is never quietly cut short.
--   * admin_users_page: the Users table, filters and per-member counts in
--     one query, with the exact total.
--   * admin_audit_actor_ids: the actors in the audit log whose name matches
--     a search (a handful of admins), for the audit filter and its export.
-- All three run with the caller's rights and only the service role (the
-- console's read layer, behind requireAdminRead) may call them.

begin;

create or replace function public.admin_export_orders(
  p_view text,
  p_query text default null,
  p_status text default null,
  p_category text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_min_cents integer default null,
  p_max_cents integer default null,
  p_after_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 500
)
returns table (
  id uuid,
  sort_at timestamptz,
  created_at timestamptz,
  status text,
  total_cents integer,
  refunded_cents integer,
  currency text,
  transferred boolean,
  disputed_at timestamptz,
  dispute_resolved_at timestamptz,
  dispute_category text,
  dispute_reason text,
  refund_offer_cents integer,
  buyer_id uuid,
  buyer_username text,
  buyer_display_name text,
  seller_id uuid,
  seller_username text,
  seller_display_name text,
  title text
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_hex text;
  v_like text;
  v_limit int := least(greatest(coalesce(p_limit, 500), 1), 1000);
begin
  if p_view not in ('orders', 'disputes_open', 'disputes_resolved') then
    raise exception 'Unknown export view %', p_view using errcode = '22023';
  end if;
  if (p_after_at is null) <> (p_after_id is null) then
    raise exception 'A page cursor needs both its time and its id' using errcode = '22023';
  end if;
  -- An id-shaped search is an order-id prefix (dashes optional); a pi_
  -- search is a payment reference; anything else is a name (or, for
  -- disputes, an item title).
  if v_q ~* '^[0-9a-f-]{8,}$' then v_hex := replace(lower(v_q), '-', ''); end if;
  -- Literal text inside an ILIKE pattern: \ % and _ match themselves.
  v_like := '%' || replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  with picked as (
    select o.*,
      case p_view
        when 'orders' then o.created_at
        -- An open dispute missing its timestamp still gets a place in the order.
        when 'disputes_open' then coalesce(o.disputed_at, o.created_at)
        else o.dispute_resolved_at
      end as sort_key
    from public.orders o
    where case p_view
            when 'orders' then true
            when 'disputes_open' then o.status = 'disputed'
            else o.dispute_resolved_at is not null
          end
      and (p_status is null or p_view <> 'orders' or o.status = p_status)
      and (p_category is null or p_view = 'orders' or o.dispute_category = p_category)
      and (p_from is null or p_view <> 'orders' or o.created_at >= p_from)
      and (p_to is null or p_view <> 'orders' or o.created_at < p_to)
      and (p_min_cents is null or p_view <> 'orders' or o.total_cents >= p_min_cents)
      and (p_max_cents is null or p_view <> 'orders' or o.total_cents <= p_max_cents)
      and (
        v_q is null
        or (v_hex is not null and (
              replace(o.id::text, '-', '') like v_hex || '%'
              or (p_view = 'orders' and exists (
                select 1 from public.payments pay
                where pay.order_id = o.id and pay.provider_reference ilike v_q || '%'))))
        or (v_hex is null and lower(v_q) like 'pi\_%' and p_view = 'orders' and exists (
              select 1 from public.payments pay
              where pay.order_id = o.id and pay.provider_reference ilike v_q || '%'))
        or (v_hex is null and not (p_view = 'orders' and lower(v_q) like 'pi\_%') and (
              exists (
                select 1 from public.profiles pr
                where pr.id in (o.buyer_id, o.seller_id)
                  and (pr.username ilike v_like or pr.display_name ilike v_like))
              or (p_view <> 'orders' and exists (
                select 1 from public.order_items oi
                where oi.order_id = o.id and oi.title ilike v_like))))
      )
  )
  select p.id, p.sort_key, p.created_at, p.status, p.total_cents, p.refunded_cents, p.currency,
         p.transfer_reference is not null,
         p.disputed_at, p.dispute_resolved_at, p.dispute_category, p.dispute_reason, p.refund_offer_cents,
         p.buyer_id, b.username, b.display_name,
         p.seller_id, s.username, s.display_name,
         items.title
  from picked p
  left join public.profiles b on b.id = p.buyer_id
  left join public.profiles s on s.id = p.seller_id
  left join lateral (
    select case when count(*) > 1
                then coalesce((array_agg(oi.title order by oi.id))[1], 'Part') || ' +' || (count(*) - 1) || ' more'
                else (array_agg(coalesce(oi.title, 'Part') order by oi.id))[1]
           end as title
    from public.order_items oi
    where oi.order_id = p.id
  ) items on true
  where p_after_id is null
     or (p_view = 'disputes_open' and (p.sort_key, p.id) > (p_after_at, p_after_id))
     or (p_view <> 'disputes_open' and (p.sort_key, p.id) < (p_after_at, p_after_id))
  order by
    case when p_view = 'disputes_open' then p.sort_key end asc,
    case when p_view = 'disputes_open' then p.id end asc,
    case when p_view <> 'disputes_open' then p.sort_key end desc,
    case when p_view <> 'disputes_open' then p.id end desc
  limit v_limit;
end;
$$;

revoke all on function public.admin_export_orders(text, text, text, text, timestamptz, timestamptz, integer, integer, timestamptz, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.admin_export_orders(text, text, text, text, timestamptz, timestamptz, integer, integer, timestamptz, uuid, integer)
  to service_role;

create or replace function public.admin_users_page(
  p_query text default null,
  p_state text default 'all',
  p_offset integer default 0,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_like text := '%' || replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_total bigint;
  v_rows jsonb;
begin
  if coalesce(p_state, 'all') not in ('all', 'suspended', 'sellers', 'no_payouts', 'admins') then
    raise exception 'Unknown member filter %', p_state using errcode = '22023';
  end if;

  with matched as (
    select pr.*
    from public.profiles pr
    where (
        v_q is null
        -- Support mail arrives by email address: match the account's email.
        or (position('@' in v_q) > 0 and exists (
              select 1 from public.account_emails e where e.user_id = pr.id and e.email ilike v_like))
        or (position('@' in v_q) = 0 and (pr.username ilike v_like or pr.display_name ilike v_like))
      )
      and case coalesce(p_state, 'all')
            when 'suspended' then pr.suspended_at is not null
            when 'admins' then exists (select 1 from public.admin_users au where au.user_id = pr.id)
            when 'sellers' then exists (select 1 from public.listings l where l.seller_id = pr.id)
                             or exists (select 1 from public.orders o where o.seller_id = pr.id)
            when 'no_payouts' then not pr.payouts_enabled and (
                               exists (select 1 from public.listings l where l.seller_id = pr.id)
                               or exists (select 1 from public.orders o where o.seller_id = pr.id))
            else true
          end
  ),
  counted as (select count(*) as n from matched),
  page as (
    select m.* from matched m
    order by m.created_at desc, m.id desc
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  )
  select (select n from counted),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', pg.id,
           'username', pg.username,
           'display_name', pg.display_name,
           'profile_type', pg.profile_type,
           'created_at', pg.created_at,
           'suspended_at', pg.suspended_at,
           'suspended_reason', pg.suspended_reason,
           'payouts_enabled', pg.payouts_enabled,
           'listing_count', (select count(*) from public.listings l where l.seller_id = pg.id),
           -- A sale is an order that was paid — cancelled and abandoned ones aren't.
           'sale_count', (select count(*) from public.orders o where o.seller_id = pg.id
                            and o.status in ('paid', 'shipped', 'delivered', 'completed', 'disputed')),
           'dispute_count', (select count(*) from public.orders o where o.seller_id = pg.id and o.disputed_at is not null)
                          + (select count(*) from public.orders o where o.buyer_id = pg.id and o.disputed_at is not null),
           'is_admin', exists (select 1 from public.admin_users au where au.user_id = pg.id)
         ) order by pg.created_at desc, pg.id desc), '[]'::jsonb)
    into v_total, v_rows
  from page pg;

  return jsonb_build_object('total', coalesce(v_total, 0), 'rows', v_rows);
end;
$$;

revoke all on function public.admin_users_page(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_users_page(text, text, integer, integer) to service_role;

create or replace function public.admin_audit_actor_ids(p_query text)
returns uuid[]
language sql
stable
set search_path = public, pg_temp
as $$
  with q as (
    select '%' || replace(replace(replace(trim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  )
  select coalesce(array_agg(pr.id), '{}')
  from public.profiles pr, q
  where length(trim(coalesce(p_query, ''))) > 0
    and (pr.username ilike q.pattern or pr.display_name ilike q.pattern)
    and exists (select 1 from public.admin_audit_log a where a.actor_id = pr.id);
$$;

revoke all on function public.admin_audit_actor_ids(text) from public, anon, authenticated;
grant execute on function public.admin_audit_actor_ids(text) to service_role;

notify pgrst, 'reload schema';

commit;
