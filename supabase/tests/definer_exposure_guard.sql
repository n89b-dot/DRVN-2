-- SECURITY DEFINER functions a signed-out caller can execute are a reviewed
-- list, not an accident of default privileges. Trigger functions are left
-- out: they can't be called except as triggers. The same goes for those a
-- signed-in member can execute. Adding a public definer function means
-- adding it to the right list here, with a reason.
begin;

do $$
declare
  reviewed text[] := array[
    'activity_post_visible(uuid)',        -- visibility predicate used by RLS; answers only for the caller
    'actor_name(uuid)',                   -- public display name
    'admin_role()',                       -- the caller's own role, null for anyone else
    'identifier_matches_listing(uuid,text)', -- part-number match on a listing, boolean only
    'is_admin()',                         -- the caller's own admin state
    'is_suspended(uuid)',                 -- used by public read policies
    'listing_public_offer_floor(uuid)',   -- a listing's minimum only when its seller chose to show it (O-3, 20261018100000)
    'listing_watch_counts(uuid[])',       -- counts only, for listings the caller can see (R2-09)
    'marketplace_search_capped_ids(text,text,text,text,text,text,integer,integer,integer)', -- the newest 1,001 ids marketplace_search_ids would give, within filters a visitor can apply; callers re-read under RLS (20261011130000)
    'marketplace_search_ids(text)',       -- ids of active parts of visible sellers matching a search; callers re-read under RLS
    'mod_purchase_sources(uuid[])',       -- source car of purchased build lines, by unguessable item id
    'profile_follow_counts(uuid)',        -- public follower counts
    'profile_is_visible(uuid)',           -- used by public read policies
    'profile_sales_count(uuid)',          -- public sales count for visible profiles
    'search_car_ids(text)',               -- ids of public builds of visible owners; definer so text indexes apply (20261010100100)
    'search_listing_ids(text)',           -- ids of parts a signed-out visitor may see; same reason
    'search_update_ids(text)',            -- ids of published updates on visible public builds; same reason
    'search_word_corrections(text)',      -- the words of a query absent from the titles/brands of parts for sale, each with its closest word there; words anyone can read (20261011130000)
    'settlement_hold_policy()',           -- the public part of settlement_settings: periods, and whether each fraud control is on, never its amount (20261107210000)
    'suspended_profile_ids()'             -- the set the read policies test against, once per query; ids only (20261010095900)
  ];
  -- Callable by signed-in members (not visitors): each answers or acts only
  -- for the caller, or requires an admin. Reviewed 17 Oct 2026 (A0).
  member_reviewed text[] := array[
    'admin_set_agent_control(text,uuid,boolean,text)', -- refuses anyone but an admin with step-up (20261021100100)
    'admin_set_agent_beta_step(text,boolean,text)', -- refuses anyone but an admin with step-up (20261024100000)
    'admin_set_agent_spend_limits(numeric,numeric,text)', -- refuses anyone but an admin with step-up (20261024100000)
    'admin_open_agent_chat(uuid,text,uuid,text)', -- admins with step-up only, a named case, audited (20261024100000)
    'admin_enrolment_state()',                         -- the caller's own console membership: pending or confirmed, null otherwise (20261107200500)
    'agent_approval_decide(uuid,text)',                -- the caller's own agent's confirm card (20261021100100)
    'agent_clear_conversation()',                      -- the caller's own agent chat
    'agent_mandate_set(text,uuid,integer,integer,integer,text,text,timestamp with time zone,boolean)', -- the caller's own agent limits, on their own listing or as a buyer
    'agent_mandate_set_status(uuid,text)',             -- pause, resume or turn off the caller's own mandate
    'agent_mode_set(text)',                            -- the caller's own agent setting; below Act ends their own mandates (20261107190000)
    'become_shop()',                                   -- turns the caller's own profile into a shop
    'bind_checkout_analytics(uuid[])',                 -- tags the caller's own orders with consented analytics ids
    'bump_listing_view(uuid)',                         -- counts a view by the caller, rate-limited, never the seller's own
    'claim_listing_creation(uuid,text)',               -- the caller's own create-listing request
    'complete_listing_creation(uuid,text,uuid)',       -- same request, finished
    'discard_listing_creation(uuid,text)',             -- same request, abandoned
    'execute_admin_command(text,uuid,text,jsonb)',     -- refuses anyone but an admin
    'listing_edit_status(uuid,uuid)',                  -- the caller's own edit request on their own listing
    'listing_question_parent_matches(uuid,uuid)',      -- boolean: a reply's parent is on a listing the caller can see
    'my_car_vin(uuid)',                                -- the caller's own car's VIN (20261004160000)
    'my_default_offer_floor()',                        -- the caller's own default minimum
    'my_listing_offer_floor(uuid)',                    -- the caller's own listing's minimum (20261017120000)
    'offer_move(uuid,text,integer,text,integer)',      -- a move on an offer the caller is party to, under the v2 rules (20261017160000)
    'offer_open(uuid,uuid,integer,text)',              -- the caller's own opening offer, under the v2 rules (20261017160000)
    'order_buyer_reviewable(uuid)',                    -- boolean, only for the order's buyer or seller
    'price_comparables(text,text,text,uuid)',          -- aggregates of completed sales and live listings of one product, only from 3 up; no rows or ids (20261020140000)
    'reconcile_admin_external_operation(uuid,bigint,text,text)', -- refuses anyone but an admin with step-up
    'record_listing_edit(uuid,text,uuid,timestamp with time zone,jsonb)', -- the caller's own edit request
    'replay_listing_edit(uuid,text,uuid,timestamp with time zone)',      -- same request, replayed for its owner
    'resolve_product_identity_review(uuid,text,text)', -- refuses anyone but an admin with step-up (20261020120000)
    'copyright_takedown(uuid,uuid[],text[],text)', -- refuses anyone but an admin with step-up (20261107231002)
    'reject_copyright_notice(uuid,text)', -- refuses anyone but an admin with step-up (20261107231002)
    'request_account_deletion()',                      -- the caller's own account
    'request_account_export()',                        -- the caller's own export
    'seller_payout_dates(uuid[])',                     -- payout dates of the caller's own sales only
    'set_analytics_consent(boolean)',                  -- the caller's own consent
    'set_listing_offer_floor(uuid,integer)',           -- the caller's own listing's minimum; the one writer of it (20261019120000)
    'sync_activity_post_listings(uuid,uuid[])'         -- parts tagged on the caller's own post
  ];
  exposed text[];
  internal text;
begin
  select coalesce(array_agg(p.oid::regprocedure::text order by 1), '{}') into exposed
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.prosecdef
    and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('anon', p.oid, 'execute')
    and not (p.oid::regprocedure::text = any(reviewed));
  if cardinality(exposed) > 0 then
    raise exception 'Unreviewed SECURITY DEFINER functions executable by anon: %', exposed;
  end if;

  select coalesce(array_agg(p.oid::regprocedure::text order by 1), '{}') into exposed
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.prosecdef
    and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('authenticated', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute')
    and not (p.oid::regprocedure::text = any(member_reviewed));
  if cardinality(exposed) > 0 then
    raise exception 'Unreviewed SECURITY DEFINER functions executable by signed-in members: %', exposed;
  end if;

  -- The internal ones stay closed to every client role.
  foreach internal in array array[
    'public.notify(uuid,text,text,text,text,text,uuid)',
    'public.invoke_transfer_worker()',
    'public.mark_due_transfer_intents()',
    'public.escalate_stale_disputes()',
    'public.prune_rate_limits()',
    'public.offer_effective_floor(uuid)',
    'public.offer_accept_begin(uuid,uuid,interval)',
    -- The agent's internals (20261021100100): the move cores take the actor
    -- as an argument; the sweeps are the service role's.
    'public.offer_open_core(uuid,uuid,uuid,integer,text,jsonb)',
    'public.offer_move_core(uuid,uuid,text,integer,text,integer,jsonb)',
    'public.agent_enqueue_turns(uuid)',
    'public.agent_lock_job(uuid,uuid,text)',
    'public.agent_halt_reason(text,uuid,uuid,uuid,uuid)',
    'public.agent_reconcile_outbox(integer)',
    'public.agent_retention_sweep()',
    'public.agent_purge_member(uuid)',
    'public.agent_health()',
    'public.agent_claim_jobs(integer,integer)',
    'public.agent_offer_move(uuid,uuid,uuid,text,integer,integer)'
  ] loop
    if has_function_privilege('anon', internal, 'execute')
       or has_function_privilege('authenticated', internal, 'execute') then
      raise exception '% is callable by a client role', internal;
    end if;
  end loop;

  -- Retired by the negotiation contract (20261019120000): the pre-v2 offer
  -- path and the private minimum's switch-step machinery.
  foreach internal in array array[
    'public.create_offer_with_message(uuid,uuid,integer,text)',
    'public.guard_offer_private_floor()',
    'public.absorb_listing_offer_floor()'
  ] loop
    if to_regprocedure(internal) is not null then
      raise exception '% is still installed', internal;
    end if;
  end loop;

  raise notice 'all definer exposure checks passed';
end $$;

rollback;
