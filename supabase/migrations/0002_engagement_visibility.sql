-- Owners of a target (profile, car, listing) can see who followed/saved it,
-- so notifications can be derived. Actors' own rows remain readable via the
-- existing "manage own" policies.

create policy "target owners read follows" on public.follows for select
  using (
    (target_type = 'profile' and target_id = auth.uid())
    or (target_type = 'car' and exists (
      select 1 from public.cars c where c.id = target_id and c.owner_id = auth.uid()
    ))
  );

create policy "target owners read saves" on public.saves for select
  using (
    (target_type = 'profile' and target_id = auth.uid())
    or (target_type = 'car' and exists (
      select 1 from public.cars c where c.id = target_id and c.owner_id = auth.uid()
    ))
    or (target_type = 'listing' and exists (
      select 1 from public.listings l where l.id = target_id and l.seller_id = auth.uid()
    ))
  );
