-- Keep the single-use audit fact when account deletion nulls consumed_by.
-- The original constraint required consumed_at and consumed_by to disappear
-- together, which conflicted with the foreign key's ON DELETE SET NULL.
begin;

alter table public.beta_invitations
  drop constraint beta_invitations_consumption_pair,
  add constraint beta_invitations_consumption_pair check (
    consumed_at is not null or consumed_by is null
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.beta_invitations'::regclass
      and conname = 'beta_invitations_consumption_pair'
      and pg_get_constraintdef(oid) like '%consumed_at IS NOT NULL%consumed_by IS NULL%'
  ) then
    raise exception 'R01: consumed invitation retention constraint is missing';
  end if;
end;
$$;

commit;
