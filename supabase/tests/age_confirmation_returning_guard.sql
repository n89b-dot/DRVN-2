-- 20261108150000 (N686): members who joined before the 18+ confirmation are
-- asked once at their next sign-in, and their answer is recorded as
-- 'returning_member'. The record keeps every rule of 20261107231001: written
-- by the server only, never rewritten, readable only by its own member.
-- Transactional; disposable local or CI database only.
begin;

do $$
declare
  v_member uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_failed boolean;
begin
  insert into auth.users (id, email) values
    (v_member, 'returning-age@drvn.test'), (v_other, 'returning-age-other@drvn.test');

  -- 1. The server records a returning member's answer.
  insert into public.age_confirmations (user_id, source) values (v_member, 'returning_member');
  if (select source from public.age_confirmations where user_id = v_member) is distinct from 'returning_member' then
    raise exception 'FAIL 1: a returning member''s confirmation was not recorded as returning_member (N686)';
  end if;

  -- 2. Every earlier source is still accepted, and an unknown one is refused.
  begin
    insert into public.age_confirmations (user_id, source) values (v_other, 'admin_backfill');
    v_failed := false;
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 2: an unknown confirmation source was accepted (N686)'; end if;
  insert into public.age_confirmations (user_id, source) values (v_other, 'guest_checkout');

  -- 3. The answer is still never rewritten.
  begin
    update public.age_confirmations set source = 'onboarding' where user_id = v_member;
    v_failed := false;
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL 3: a returning member''s confirmation was rewritten (N686)'; end if;

  -- 4. A member still cannot write their own record.
  if has_table_privilege('authenticated', 'public.age_confirmations', 'insert')
     or has_table_privilege('anon', 'public.age_confirmations', 'select') then
    raise exception 'FAIL 4: age confirmations are no longer server-written and private (N686)';
  end if;

  raise notice 'all returning-member age confirmation checks passed';
end $$;

rollback;
