begin;
create temporary table review_owner as select gen_random_uuid() id;
insert into auth.users(id,email) select id,'catalog-review-'||id||'@example.test' from review_owner;
with fixture(id,title,description,category,subcategory) as (values
  ('cff127a1-e5c3-4871-9b35-be114461b54d', '992 GT3 centre-lock wheels with Michelin Cup 2, set of four', 'Factory centre-locks with Cup 2s at about 5mm tread. Ring miles only, no kerb strikes. Centre-lock nuts included, wrench not.', 'wheels-tires', null),
  ('daace295-f0ae-4e0c-adb1-df3c46abef06', 'Akrapovič Evolution titanium exhaust, Huracán Performante', 'Complete Evolution Line system — titanium mufflers, X-pipe, link pipes and carbon tips. One season, 3k miles. Light heat tint on the welds as expected, no dents or cracks. Removed for a full race system with headers.', 'performance', null),
  ('106e584e-7c6a-45e7-86d0-36b497efb10f', 'Audi 4.2 FSI V8 intake manifold (B7 RS4), used', 'Cast-aluminium intake manifold off my B7 RS4 4.2 FSI, removed during the carbon clean when I went to a spare. Surface oil staining as pictured, no cracks, all threads good. Flaps and runners move freely. Sold as-is for a rebuild or spare.', 'performance', 'intake'),
  ('35195d25-196c-40fd-bef6-a13765efb224', 'Big brake kit — 355mm rotors, 4-pot calipers, lines', 'Complete front kit, one season of track use. Rotors have life left, calipers rebuilt with new seals before removal. Pads included are down to half.', 'brakes-suspension', null),
  ('f0cf8b5c-0ce3-4f68-a52d-bc40bc38fbd0', 'Capristo valved exhaust, 458 Italia / Speciale', 'Full Capristo system with valve controller, 8k miles. Replaced with a titanium setup. No cracks at the welds, tips show light heat colour only.', 'performance', null),
  ('36604617-5ff1-4595-ba1d-9777cd9f1285', 'E46 M3 front sport seats, black leather, pair', 'Out of the car for buckets. Driver bolster shows honest wear, photographed. Rails and airbag connectors intact, no rips or tears.', 'interior-lighting', null),
  ('8067c1aa-ab7c-4068-a379-6244c330b445', 'Ferrari 458 Speciale forged 20in wheels, OEM set of four', 'Factory forged wheels off the Speciale, removed for an aftermarket set. Two small kerb marks on the front-left, photographed. Straight and true, no repairs.', 'wheels-tires', null),
  ('8368fe15-874b-4bf8-8fe8-bf0db36ab565', 'Garrett GT2871R, 40k km, shaft play in spec', 'Pulled during the build for a bigger single. Light shaft play well within spec, no contact marks on the wheels. Oil lines included, manifold not.', 'performance', null),
  ('f149864e-5307-4dec-bf82-a72060a2c699', 'Huracán Performante forged carbon rear wing, OEM', 'Factory forged composite wing, removed for a taller aftermarket unit. No chips or cracks, ALA ducting intact. Comes with the mounting hardware.', 'exterior-body', null),
  ('cec014e5-a3b2-4709-8e95-7a9cd1f21343', 'IPD front + rear sway bar set, 850/S70/V70', 'The classic upgrade. Bushings have life left, bars are straight with surface patina only. Sold because the new car came with them fitted.', 'brakes-suspension', null),
  ('95d81551-19bf-4490-9107-63d92baa0e1a', 'KW Variant 2 coilovers — Delta HF fitment', 'Coming off for the Bilstein alpine setup. Spring rate 8K front / 6K rear, damper travel 62 mm of 68 mm new. Top mounts, spanners, box included.', 'performance', null),
  ('ba4afb1b-6656-4d13-8a99-c7e06a5a201b', 'Öhlins Road & Track coilovers, 12k miles', 'Off the Genny. Fresh service at 10k.', 'brakes-suspension', null),
  ('9dc2a581-38f8-4ad0-b2ff-5c579eb7999d', 'Porsche 992 GT3 full bucket seats, carbon, pair', 'Factory carbon full buckets, removed for 18-way comfort seats for longer trips. Bolsters are unmarked, no sun fade. Side airbags and rails included.', 'interior-lighting', null),
  ('7303e978-af48-4e7f-adcc-98206aa6ac07', 'Rays bronze 17x9 +22 square set, tires included', 'Ran one season on the S15. Two wheels have light curb rash photographed up close. Tires are 240 treadwear with half life left. No bends, no repairs — holds pressure fine.', 'wheels-tires', null),
  ('7a348e30-e66c-4cba-b134-f5579ed851eb', 'Sabelt bucket seat — driver side', 'Replaced by the Recaro. Driver side, wide pattern rails. One bolster scuff photographed.', 'interior-lighting', null),
  ('d935d3e8-a367-4836-8978-4db74e344f8c', 'Thule roof box + rack, fits most wagons', 'Off the 850 after a camping summer. Sun-faded but no cracks, both locks work with keys. Rack feet included for square rails.', 'exterior-body', null)
)
insert into public.listings(id,seller_id,title,description,category,subcategory,price_cents,status,currency)
select f.id::uuid,o.id,f.title,f.description,f.category,f.subcategory,1000,'active','USD'
from fixture f cross join review_owner o;
\ir ../migrations/20260913144218_marketplace_evidenced_part_types.sql
-- Repeatability: populated classifications must not be overwritten.
\ir ../migrations/20260913144218_marketplace_evidenced_part_types.sql
do $$ begin
 if (select count(*) from public.listings where seller_id=(select id from review_owner) and subcategory is not null)<>15 then raise exception 'Expected fifteen classified parts'; end if;
 if (select category from public.listings where id='95d81551-19bf-4490-9107-63d92baa0e1a')<>'brakes-suspension' then raise exception 'Coilovers still in wrong parent'; end if;
 if (select subcategory from public.listings where id='d935d3e8-a367-4836-8978-4db74e344f8c') is not null then raise exception 'Roof box classification was guessed'; end if;
end $$;
update public.listings set subcategory=null,title='Seller changed the part' where id='daace295-f0ae-4e0c-adb1-df3c46abef06';
update public.listings set subcategory='tuning' where id='f0cf8b5c-0ce3-4f68-a52d-bc40bc38fbd0';
\ir ../migrations/20260913144218_marketplace_evidenced_part_types.sql
do $$ begin
 if (select subcategory from public.listings where id='daace295-f0ae-4e0c-adb1-df3c46abef06') is not null then raise exception 'Changed facts overwritten'; end if;
 if (select subcategory from public.listings where id='f0cf8b5c-0ce3-4f68-a52d-bc40bc38fbd0')<>'tuning' then raise exception 'Seller classification overwritten'; end if;
 raise notice 'all catalog assignment checks passed';
end $$;
rollback;
