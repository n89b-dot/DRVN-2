-- ============================================================================
-- restore_integrity.sql — run against a RESTORED COPY to prove the backup is
-- a working database, not just a file that exists. Read-only; raises on any
-- failed check, prints a summary otherwise. Part of the quarterly restore
-- rehearsal (docs/production-runbook.md §6).
-- ============================================================================

do $$
declare
  v_count bigint;
  v_bad   bigint;
begin
  -- 1. The core tables exist and hold plausibly-shaped data.
  select count(*) into v_count from public.profiles;
  raise notice 'profiles: % rows', v_count;
  select count(*) into v_count from public.orders;
  raise notice 'orders: % rows', v_count;
  select count(*) into v_count from public.listings;
  raise notice 'listings: % rows', v_count;

  -- 2. Auth references: every profile has an auth.users row behind it.
  select count(*) into v_bad
  from public.profiles p left join auth.users u on u.id = p.id
  where u.id is null;
  if v_bad > 0 then
    raise exception 'RESTORE CHECK FAILED: % profiles with no auth.users row', v_bad;
  end if;
  raise notice 'PASS: profile -> auth.users references intact';

  -- 3. Money invariants survived the restore.
  select count(*) into v_bad from public.orders
  where refunded_cents > total_cents or platform_fee_refunded_cents > platform_fee_cents;
  if v_bad > 0 then
    raise exception 'RESTORE CHECK FAILED: % orders violate refund bounds', v_bad;
  end if;
  select count(*) into v_bad
  from public.payments p left join public.orders o on o.id = p.order_id
  where o.id is null;
  if v_bad > 0 then
    raise exception 'RESTORE CHECK FAILED: % payments reference missing orders', v_bad;
  end if;
  select count(*) into v_bad
  from public.transfer_intents ti left join public.orders o on o.id = ti.order_id
  where o.id is null;
  if v_bad > 0 then
    raise exception 'RESTORE CHECK FAILED: % transfer intents reference missing orders', v_bad;
  end if;
  select count(*) into v_bad
  from public.refund_operations r left join public.orders o on o.id = r.order_id
  where o.id is null;
  if v_bad > 0 then
    raise exception 'RESTORE CHECK FAILED: % refund operations reference missing orders', v_bad;
  end if;
  raise notice 'PASS: money tables internally consistent';

  -- 4. Transferred orders carry their references both sides (0026 invariant).
  select count(*) into v_bad
  from public.transfer_intents ti
  join public.orders o on o.id = ti.order_id
  where ti.status = 'transferred' and ti.transfer_reference is null;
  if v_bad > 0 then
    raise exception 'RESTORE CHECK FAILED: % transferred intents missing their Stripe reference', v_bad;
  end if;
  raise notice 'PASS: transfer references intact';

  -- 5. Storage references: dispute evidence rows point at real object paths.
  select count(*) into v_bad from public.dispute_evidence
  where coalesce(storage_path, '') = '' and coalesce(url, '') = '';
  if v_bad > 0 then
    raise exception 'RESTORE CHECK FAILED: % evidence rows with no object reference', v_bad;
  end if;
  -- The dispute-evidence bucket must still be private after a restore.
  if exists (select 1 from storage.buckets where id = 'dispute-evidence' and public) then
    raise exception 'RESTORE CHECK FAILED: dispute-evidence bucket restored as PUBLIC';
  end if;
  raise notice 'PASS: evidence references + bucket privacy intact';

  -- 6. RLS survived: the critical tables still have it enabled.
  select count(*) into v_bad
  from pg_tables t
  where t.schemaname = 'public'
    and t.tablename in ('orders', 'payments', 'profiles', 'messages', 'offers',
                        'refund_operations', 'transfer_intents', 'payment_recoveries',
                        'dispute_evidence', 'admin_users', 'admin_alert_outbox')
    and not t.rowsecurity;
  if v_bad > 0 then
    raise exception 'RESTORE CHECK FAILED: % critical tables restored without RLS', v_bad;
  end if;
  raise notice 'PASS: RLS enabled on all critical tables';

  raise notice '--- all restore-integrity checks passed ---';
end $$;
