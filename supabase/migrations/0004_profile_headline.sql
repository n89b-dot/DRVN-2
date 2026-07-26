begin;
-- headline field for the profile identity line (Figma: "Product Designer in Fort Lauderdale, Florida")
alter table public.profiles add column if not exists headline text;
update profiles set headline='Product Designer' where id='__NEIL__';

-- second car: 2000 Toyota MR2, Spectra Blue (per Figma)
insert into cars (owner_id, slug, name, make, model, year, color, about, tags, cover_image_url, is_public)
values ('__NEIL__','toyota-mr2-__SFX__','Toyota MR2','Toyota','MR2',2000,'Spectra Blue',
        'Weekend momentum car. Mid-engine, light, and mostly stock while I sort the suspension.',
        array['Spectra Blue','Weekend car'],'__MBASE__/mr2-1.jpg', true)
on conflict (slug) do nothing;

insert into car_images (car_id, url, alt, position)
select id, '__MBASE__/mr2-1.jpg', 'MR2 Spyder front', 0 from cars where slug='toyota-mr2-__SFX__'
union all select id, '__MBASE__/mr2-2.jpg', 'MR2 Spyder front left', 1 from cars where slug='toyota-mr2-__SFX__'
union all select id, '__MBASE__/mr2-3.jpg', 'MR2 Spyder rear', 2 from cars where slug='toyota-mr2-__SFX__';

-- rename the existing activity post to match the Figma reference + attach photos
update activity_posts set title='AWE Touring Edition Exhaust Install',
  intro='Installing the AWE Touring Exhaust and a few other parts over the weekend.'
  where id='a85171ef-0e4c-4258-8e4a-09aa79aa23a8';
delete from activity_images where post_id='a85171ef-0e4c-4258-8e4a-09aa79aa23a8';
insert into activity_images (post_id, url, alt, position) values
  ('a85171ef-0e4c-4258-8e4a-09aa79aa23a8','__LBASE__/part-exhaust.jpg','Exhaust on the bench',0),
  ('a85171ef-0e4c-4258-8e4a-09aa79aa23a8','__GBASE__/golf-r-4.jpg','Golf R rear after install',1),
  ('a85171ef-0e4c-4258-8e4a-09aa79aa23a8','__GBASE__/golf-r-1.jpg','Golf R front',2);
commit;
