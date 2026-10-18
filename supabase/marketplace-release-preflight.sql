-- Read-only. Run against the selected release database before promoting an app.
-- A false commerce check blocks release; it must not trigger a fallback to an
-- older, less strict purchase function or bypass the existing release gate.
with required(name) as (values
 ('marketplace_browse_rows'), ('marketplace_category_counts'),
 ('marketplace_match_evidence'), ('save_marketplace_search'),
 ('set_social_relationship'), ('offer_open'), ('offer_move'),
 ('record_worker_run'), ('set_analytics_consent'),
 ('prepare_payment_request'), ('freeze_cart_checkout_shipping'),
 ('bind_cart_checkout_payment'), ('bind_checkout_analytics')
)
select 'function:'||name as check_name,
 exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname=name) as ready
from required
union all
select 'purchase_begin accepts checkout identity',exists(
 select 1 from pg_proc where pronamespace='public'::regnamespace and proname='purchase_begin'
 and 'p_checkout_request_key'=any(proargnames) and 'p_checkout_context'=any(proargnames))
union all
select 'purchase analytics outbox',to_regclass('public.remediation_jobs') is not null
order by check_name;
