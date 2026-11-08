-- OS-W29: the 8-photo dispute-evidence limit holds under concurrent attaches.
--
-- addDisputeEvidence (src/features/commerce/dispute-actions.ts) counted the
-- uploader's attached photos and then inserted, in two separate requests. Two
-- attaches at once each counted 7, both passed the limit of 8, and the
-- dispute ended up with 9 from one party. Nothing in the database held the
-- limit; it was only checked in the app, and only in that one path.
--
-- A BEFORE INSERT trigger on dispute_evidence now holds it for every writer.
-- It takes a transaction advisory lock per order and uploader (the pattern of
-- my_dispute_evidence_upload_count, 20261108130100), then counts with a fresh
-- snapshot, so a second attach waits for the first to commit and then sees
-- it. The count and the insert are in the same transaction. Over the limit it
-- raises check_violation (23514), which the action turns into its own
-- message. The upload policy's matching check on storage.objects
-- (20261107203000, 20261107220000) is unchanged.

begin;

create or replace function private.dispute_evidence_attach_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  -- A row whose uploader's account is gone has no one to limit.
  if new.uploader_id is null then
    return new;
  end if;
  -- Held to the end of the attach's transaction: a second attach by the same
  -- party to the same dispute waits here until the first has committed (or
  -- failed), and the count below, a new statement with a new snapshot, then
  -- includes it.
  perform pg_advisory_xact_lock(
    hashtextextended('dispute-evidence-attach:' || new.uploader_id::text || ':' || new.order_id::text, 0)
  );
  select count(*)::int into v_count
    from public.dispute_evidence de
   where de.order_id = new.order_id
     and de.uploader_id = new.uploader_id;
  if v_count >= 8 then
    raise exception 'You''ve attached the maximum of 8 photos.'
      using errcode = 'check_violation',
            detail = format('dispute_evidence: %s already attached by this party to this order', v_count);
  end if;
  return new;
end;
$$;

revoke all on function private.dispute_evidence_attach_cap() from public, anon, authenticated;

comment on function private.dispute_evidence_attach_cap() is
  'OS-W29: at most 8 evidence photos per party per dispute, counted under a per-order-and-uploader lock so concurrent attaches cannot pass it together. Raises 23514.';

-- Named to fire before zz_media_claim_guard (BEFORE triggers fire in name order).
drop trigger if exists dispute_evidence_attach_cap on public.dispute_evidence;
create trigger dispute_evidence_attach_cap
  before insert on public.dispute_evidence
  for each row execute function private.dispute_evidence_attach_cap();

-- An uploader's count reads (order_id, uploader_id); the order index and the
-- uploader foreign-key index (20261107153100) both serve it.

commit;
