-- N29 (production-readiness 2026-11-03): foreign keys with no index.
--
-- Postgres indexes the referenced side of a foreign key, never the
-- referencing side. Without an index there, deleting or re-keying a parent
-- row reads the whole child table once per row — account deletion (a
-- profile and its auth user go, and every table pointing at them is
-- cascaded, nulled or checked), a seller deleting a listing (its offers,
-- their rounds, agent jobs and tasks), the agent retention sweep deleting
-- finished jobs and tasks (events, telemetry, usage and offer rounds point
-- at them) — and "everything by this member" reads do the same.
--
-- Coverage was measured, not taken from the report: every migration applied
-- to a fresh database, then every public foreign key checked for an index
-- whose leading key columns (not INCLUDE columns; a valid index) are the
-- key's columns. A partial index counts only
-- when its predicate is "<column> IS NOT NULL", which every lookup by a value
-- satisfies. 74 keys had none (the report's six, plus offer_rounds.buyer_id,
-- were among them). This adds 67:
--   * a NOT NULL key gets a plain index;
--   * a nullable key gets a partial index of the rows that point somewhere,
--     so mostly-empty actor columns (resolved_by, verified_by, …) cost
--     next to nothing to keep.
-- The seven left out are deliberate and listed, with reasons, in the guard
-- (supabase/tests/foreign_key_index_guard.sql), which fails on any new
-- foreign key without a covering index:
--   * cars.catalog_make_id, cars.catalog_model_id, product_fitments'
--     catalog_model_id and (generation_id, catalog_model_id): reference
--     catalogue rows the product never deletes; reads use the existing
--     partial indexes (cars_catalog_*_idx, product_fitments_vehicle_idx);
--   * beta_access_config.updated_by, agent_spend_limits.changed_by,
--     agent_beta_steps.changed_by: one-row and four-row settings tables.
--
-- Plain CREATE INDEX (not CONCURRENTLY): migrations run in a transaction,
-- and every table here is small today.

begin;

-- NOT NULL foreign keys: a plain index.
create index if not exists activity_comments_author_id_idx on public.activity_comments (author_id);
create index if not exists activity_reactions_user_id_idx on public.activity_reactions (user_id);
create index if not exists agent_approvals_task_id_idx on public.agent_approvals (task_id);
create index if not exists agent_jobs_listing_id_idx on public.agent_jobs (listing_id);
create index if not exists agent_mandate_versions_owner_id_idx on public.agent_mandate_versions (owner_id);
create index if not exists agent_mandates_listing_id_idx on public.agent_mandates (listing_id);
create index if not exists agent_mandates_owner_id_idx on public.agent_mandates (owner_id);
create index if not exists agent_messages_owner_id_idx on public.agent_messages (owner_id);
create index if not exists listing_questions_author_id_idx on public.listing_questions (author_id);
create index if not exists offer_rounds_buyer_id_idx on public.offer_rounds (buyer_id);
create index if not exists outbound_label_void_requests_order_id_idx on public.outbound_label_void_requests (order_id);
create index if not exists outbound_label_void_requests_seller_id_idx on public.outbound_label_void_requests (seller_id);
create index if not exists refund_lifecycle_adjustments_event_id_idx on public.refund_lifecycle_adjustments (event_id);
create index if not exists refund_recredit_proofs_verified_by_idx on public.refund_recredit_proofs (verified_by);
create index if not exists reviews_reviewer_id_idx on public.reviews (reviewer_id);

-- Nullable foreign keys: only the rows that point somewhere.
create index if not exists account_deletion_requests_job_id_idx on public.account_deletion_requests (job_id) where job_id is not null;
create index if not exists agent_approvals_offer_id_idx on public.agent_approvals (offer_id) where offer_id is not null;
create index if not exists agent_controls_cleared_by_idx on public.agent_controls (cleared_by) where cleared_by is not null;
create index if not exists agent_controls_set_by_idx on public.agent_controls (set_by) where set_by is not null;
create index if not exists agent_events_job_id_idx on public.agent_events (job_id) where job_id is not null;
create index if not exists agent_events_mandate_id_idx on public.agent_events (mandate_id) where mandate_id is not null;
create index if not exists agent_messages_task_id_idx on public.agent_messages (task_id) where task_id is not null;
create index if not exists agent_tasks_listing_id_idx on public.agent_tasks (listing_id) where listing_id is not null;
create index if not exists agent_tasks_offer_id_idx on public.agent_tasks (offer_id) where offer_id is not null;
create index if not exists agent_telemetry_job_id_idx on public.agent_telemetry (job_id) where job_id is not null;
create index if not exists agent_telemetry_owner_id_idx on public.agent_telemetry (owner_id) where owner_id is not null;
create index if not exists agent_telemetry_task_id_idx on public.agent_telemetry (task_id) where task_id is not null;
create index if not exists agent_usage_task_id_idx on public.agent_usage (task_id) where task_id is not null;
create index if not exists beta_invitations_consumed_by_idx on public.beta_invitations (consumed_by) where consumed_by is not null;
create index if not exists beta_invitations_created_by_idx on public.beta_invitations (created_by) where created_by is not null;
create index if not exists beta_invitations_revoked_by_idx on public.beta_invitations (revoked_by) where revoked_by is not null;
create index if not exists beta_memberships_revoked_by_idx on public.beta_memberships (revoked_by) where revoked_by is not null;
create index if not exists car_hotspots_mod_item_id_idx on public.car_hotspots (mod_item_id) where mod_item_id is not null;
create index if not exists dispute_evidence_uploader_id_idx on public.dispute_evidence (uploader_id) where uploader_id is not null;
create index if not exists listing_imports_listing_id_idx on public.listing_imports (listing_id) where listing_id is not null;
create index if not exists notifications_actor_id_idx on public.notifications (actor_id) where actor_id is not null;
create index if not exists offer_rounds_actor_job_id_idx on public.offer_rounds (actor_job_id) where actor_job_id is not null;
create index if not exists offer_rounds_actor_member_id_idx on public.offer_rounds (actor_member_id) where actor_member_id is not null;
create index if not exists offer_rounds_actor_task_id_idx on public.offer_rounds (actor_task_id) where actor_task_id is not null;
create index if not exists offers_last_round_id_idx on public.offers (last_round_id) where last_round_id is not null;
create index if not exists orders_dispute_escalated_by_idx on public.orders (dispute_escalated_by) where dispute_escalated_by is not null;
create index if not exists orders_disputed_by_idx on public.orders (disputed_by) where disputed_by is not null;
create index if not exists part_number_links_created_by_idx on public.part_number_links (created_by) where created_by is not null;
create index if not exists part_number_links_verified_by_idx on public.part_number_links (verified_by) where verified_by is not null;
create index if not exists payment_recoveries_order_id_idx on public.payment_recoveries (order_id) where order_id is not null;
create index if not exists payment_recoveries_resolved_by_idx on public.payment_recoveries (resolved_by) where resolved_by is not null;
create index if not exists pickup_confirmations_redeemed_by_idx on public.pickup_confirmations (redeemed_by) where redeemed_by is not null;
create index if not exists product_fitments_created_by_idx on public.product_fitments (created_by) where created_by is not null;
create index if not exists product_fitments_verified_by_idx on public.product_fitments (verified_by) where verified_by is not null;
create index if not exists product_identity_reviews_resolved_by_idx on public.product_identity_reviews (resolved_by) where resolved_by is not null;
create index if not exists product_part_numbers_link_id_idx on public.product_part_numbers (link_id) where link_id is not null;
create index if not exists product_part_numbers_verified_by_idx on public.product_part_numbers (verified_by) where verified_by is not null;
create index if not exists profiles_main_car_id_idx on public.profiles (main_car_id) where main_car_id is not null;
create index if not exists purchase_attempts_buyer_id_idx on public.purchase_attempts (buyer_id) where buyer_id is not null;
create index if not exists refund_operations_recovery_id_idx on public.refund_operations (recovery_id) where recovery_id is not null;
create index if not exists refund_provider_events_order_id_idx on public.refund_provider_events (order_id) where order_id is not null;
create index if not exists refund_provider_events_refund_operation_id_idx on public.refund_provider_events (refund_operation_id) where refund_operation_id is not null;
create index if not exists reports_reporter_id_idx on public.reports (reporter_id) where reporter_id is not null;
create index if not exists reports_resolved_by_idx on public.reports (resolved_by) where resolved_by is not null;
create index if not exists returns_refund_operation_id_idx on public.returns (refund_operation_id) where refund_operation_id is not null;
create index if not exists returns_requested_by_idx on public.returns (requested_by) where requested_by is not null;
create index if not exists seller_adjustments_shipment_id_idx on public.seller_adjustments (shipment_id) where shipment_id is not null;
create index if not exists seller_carry_entries_adjustment_id_idx on public.seller_carry_entries (adjustment_id) where adjustment_id is not null;
create index if not exists shipments_return_id_idx on public.shipments (return_id) where return_id is not null;
create index if not exists shipping_rate_quotes_buyer_id_idx on public.shipping_rate_quotes (buyer_id) where buyer_id is not null;
create index if not exists shipping_rate_quotes_consumed_order_id_idx on public.shipping_rate_quotes (consumed_order_id) where consumed_order_id is not null;
create index if not exists transfer_intents_seller_id_idx on public.transfer_intents (seller_id) where seller_id is not null;

commit;
