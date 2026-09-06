-- Synthetic data for local-recovery-rehearsal.sh's newly created database only.
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000001','restore-seller@drvn.test'),
 ('00000000-0000-4000-8000-000000000002','restore-buyer@drvn.test');
insert into public.listings(id,seller_id,title,category,price_cents,status) values
 ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','Synthetic recovery listing','engine',10000,'reserved');
insert into public.orders(id,buyer_id,seller_id,status,subtotal_cents,platform_fee_cents,total_cents) values
 ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','pending',10000,1000,10000);
insert into public.order_items(order_id,listing_id,title,price_cents,commercial_snapshot) values
 ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000003','Synthetic recovery listing',10000,'{"version":1,"recovery_fixture":true}');
insert into public.payment_requests(operation_key,request,provider_reference) values
 ('recovery-fixture-payment','{"order_id":"00000000-0000-4000-8000-000000000004","amount_cents":10000}','pi_synthetic_no_provider');
insert into public.remediation_jobs(kind,dedup_key,payload) values
 ('receipt','recovery-fixture-receipt','{"order_id":"00000000-0000-4000-8000-000000000004"}');
insert into private.listing_creation_requests(seller_id,request_id,payload_hash,listing_id,completed_at) values
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005',repeat('a',64),'00000000-0000-4000-8000-000000000003',now());
insert into storage.objects(bucket_id,name,owner) values
 ('dispute-evidence','recovery-fixture/evidence.txt','00000000-0000-4000-8000-000000000002');
insert into public.job_config(key,value) values ('transfer_worker_url','https://must-never-run.invalid');
