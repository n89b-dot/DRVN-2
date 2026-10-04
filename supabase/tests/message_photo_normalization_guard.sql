-- 20261005100000: a browser credential cannot put original (EXIF-bearing)
-- bytes into the message-photos bucket; only the server re-encode can.
begin;
-- Hosted Supabase grants these; the CI image's storage stand-in doesn't.
-- Granted inside this rolled-back transaction so RLS is what's under test.
grant select, insert, update, delete on storage.objects to authenticated, service_role;
do $$
declare sender uuid:=gen_random_uuid(); recipient uuid:=gen_random_uuid(); blocked boolean;
begin
 insert into auth.users(id,email) values(sender,'photo-guard-sender@example.test'),(recipient,'photo-guard-recipient@example.test');
 perform set_config('role','authenticated',true);
 perform set_config('request.jwt.claims',json_build_object('sub',sender,'role','authenticated')::text,true);
 blocked:=false;
 begin
  insert into storage.objects(bucket_id,name,owner) values('message-photos',sender||'/'||recipient||'/original.jpg',sender);
 exception when insufficient_privilege then
  if sqlerrm not like '%row-level security%' then raise; end if;
  blocked:=true;
 end;
 if not blocked then raise exception 'A browser credential uploaded an un-normalised message photo'; end if;
 -- Positive control: the same credential can still upload evidence directly,
 -- so the refusal above is this policy, not a missing grant.
 insert into storage.objects(bucket_id,name,owner) values('dispute-evidence',sender||'/evidence.jpg',sender);
 perform set_config('role','none',true);

 -- The service role (the normalising route) still writes; the sender can
 -- still read and delete their own photo.
 perform set_config('role','service_role',true);
 insert into storage.objects(bucket_id,name,owner) values('message-photos',sender||'/'||recipient||'/normalised.webp',sender);
 perform set_config('role','authenticated',true);
 if not exists(select 1 from storage.objects where bucket_id='message-photos' and name=sender||'/'||recipient||'/normalised.webp') then raise exception 'Sender cannot read their own message photo'; end if;
 perform set_config('request.jwt.claims',json_build_object('sub',recipient,'role','authenticated')::text,true);
 if not exists(select 1 from storage.objects where bucket_id='message-photos' and name=sender||'/'||recipient||'/normalised.webp') then raise exception 'Recipient cannot read the message photo'; end if;
 perform set_config('request.jwt.claims',json_build_object('sub',sender,'role','authenticated')::text,true);
 delete from storage.objects where bucket_id='message-photos' and name=sender||'/'||recipient||'/normalised.webp';
 perform set_config('role','none',true);
 if exists(select 1 from storage.objects where name=sender||'/'||recipient||'/normalised.webp') then raise exception 'Sender cannot delete their own message photo'; end if;

 -- Evidence keeps its direct, original-bytes upload path.
 if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and cmd='INSERT' and permissive='PERMISSIVE' and coalesce(with_check,'') like '%dispute-evidence%') then raise exception 'Dispute evidence lost its upload policy'; end if;
 if exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and permissive='RESTRICTIVE' and coalesce(with_check,qual,'') like '%dispute-evidence%') then raise exception 'Dispute evidence is now forced through normalisation'; end if;
 raise notice 'all message photo normalization checks passed';
end $$;
rollback;
