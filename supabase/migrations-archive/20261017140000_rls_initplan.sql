-- 20261017140000 — row security asks "who is this?" once per query, not once
-- per row (A0, the advisor's auth_rls_initplan warnings).
--
-- 88 of the 115 policies in public call auth.uid() bare, and 34 also call
-- public.is_admin() (a table read) bare. Postgres evaluates a bare function
-- call in a policy for every row it checks; wrapped in a scalar subquery,
-- `(select auth.uid())`, it becomes an InitPlan evaluated once per query.
-- Supabase's advisor flags each one. On the commerce reads (orders, order
-- items, payments, offers, messages) and every other table the cost grows
-- with the rows scanned, which matters at volume and for the agent worker.
--
-- Each statement below is its policy exactly as it stood, with only three
-- rewrites, generated from the policies' own definitions and checked by
-- reversing them:
--   auth.uid()                        -> ( SELECT auth.uid() AS uid)
--   public.is_admin()                 -> ( SELECT public.is_admin() AS is_admin)
--   public.is_suspended(auth.uid())   -> ( SELECT public.is_suspended(( SELECT auth.uid() AS uid)) AS is_suspended)
-- None of these functions reads the row, so who can read or write what is
-- unchanged; rls_initplan_guard.sql keeps new policies to the same form.
-- ALTER POLICY changes only the expressions: roles, command and
-- permissive/restrictive stay as they are. Idempotent.

begin;

alter policy "authors delete comments" on public.activity_comments
  using ((( SELECT auth.uid() AS uid) = author_id));

alter policy "authors update comments" on public.activity_comments
  using ((( SELECT auth.uid() AS uid) = author_id))
  with check ((( SELECT auth.uid() AS uid) = author_id));

alter policy "post authors delete comments" on public.activity_comments
  using ((EXISTS ( SELECT 1
   FROM public.activity_posts p
  WHERE ((p.id = activity_comments.post_id) AND (p.author_id = ( SELECT auth.uid() AS uid))))));

alter policy "suspended members don't reply" on public.activity_comments
  with check ((NOT ( SELECT public.is_suspended(( SELECT auth.uid() AS uid)) AS is_suspended)));

alter policy "users create comments" on public.activity_comments
  with check (((( SELECT auth.uid() AS uid) = author_id) AND ((char_length(body) >= 1) AND (char_length(body) <= 2000)) AND public.activity_post_visible(post_id)));

alter policy "activity images follow post" on public.activity_images
  using ((EXISTS ( SELECT 1
   FROM (public.activity_posts p
     LEFT JOIN public.cars c ON ((c.id = p.car_id)))
  WHERE ((p.id = activity_images.post_id) AND (((p.published_at IS NOT NULL) AND ((p.car_id IS NULL) OR c.is_public)) OR (p.author_id = ( SELECT auth.uid() AS uid)))))));

alter policy "authors manage activity images" on public.activity_images
  using ((EXISTS ( SELECT 1
   FROM public.activity_posts p
  WHERE ((p.id = activity_images.post_id) AND (p.author_id = ( SELECT auth.uid() AS uid))))))
  with check ((EXISTS ( SELECT 1
   FROM public.activity_posts p
  WHERE ((p.id = activity_images.post_id) AND (p.author_id = ( SELECT auth.uid() AS uid))))));

alter policy "authors delete activity" on public.activity_posts
  using ((( SELECT auth.uid() AS uid) = author_id));

alter policy "authors insert activity" on public.activity_posts
  with check (((( SELECT auth.uid() AS uid) = author_id) AND ((car_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.cars c
  WHERE ((c.id = activity_posts.car_id) AND (c.owner_id = ( SELECT auth.uid() AS uid))))))));

alter policy "authors update activity" on public.activity_posts
  using ((( SELECT auth.uid() AS uid) = author_id))
  with check ((( SELECT auth.uid() AS uid) = author_id));

alter policy "suspended members don't edit posts" on public.activity_posts
  using (true)
  with check ((NOT ( SELECT public.is_suspended(( SELECT auth.uid() AS uid)) AS is_suspended)));

alter policy "suspended members don't post" on public.activity_posts
  with check ((NOT ( SELECT public.is_suspended(( SELECT auth.uid() AS uid)) AS is_suspended)));

alter policy "users manage own reactions" on public.activity_reactions
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check (((( SELECT auth.uid() AS uid) = user_id) AND (char_length(emoji) <= 16) AND public.activity_post_visible(post_id)));

alter policy "admins read alert outbox" on public.admin_alert_outbox
  using (( SELECT public.is_admin() AS is_admin));

alter policy "admins read audit log" on public.admin_audit_log
  using (( SELECT public.is_admin() AS is_admin));

alter policy "own analytics preference" on public.analytics_consents
  using ((user_id = ( SELECT auth.uid() AS uid)));

alter policy "hotspots follow car visibility" on public.car_hotspots
  using ((EXISTS ( SELECT 1
   FROM public.cars c
  WHERE ((c.id = car_hotspots.car_id) AND (c.is_public OR (c.owner_id = ( SELECT auth.uid() AS uid)))))));

alter policy "owners manage hotspots" on public.car_hotspots
  using ((EXISTS ( SELECT 1
   FROM public.cars c
  WHERE ((c.id = car_hotspots.car_id) AND (c.owner_id = ( SELECT auth.uid() AS uid))))))
  with check ((EXISTS ( SELECT 1
   FROM public.cars c
  WHERE ((c.id = car_hotspots.car_id) AND (c.owner_id = ( SELECT auth.uid() AS uid))))));

alter policy "car images follow car visibility" on public.car_images
  using ((EXISTS ( SELECT 1
   FROM public.cars c
  WHERE ((c.id = car_images.car_id) AND (c.is_public OR (c.owner_id = ( SELECT auth.uid() AS uid)))))));

alter policy "owners manage car images" on public.car_images
  using ((EXISTS ( SELECT 1
   FROM public.cars c
  WHERE ((c.id = car_images.car_id) AND (c.owner_id = ( SELECT auth.uid() AS uid))))))
  with check ((EXISTS ( SELECT 1
   FROM public.cars c
  WHERE ((c.id = car_images.car_id) AND (c.owner_id = ( SELECT auth.uid() AS uid))))));

alter policy "owners delete cars" on public.cars
  using ((( SELECT auth.uid() AS uid) = owner_id));

alter policy "owners insert cars" on public.cars
  with check ((( SELECT auth.uid() AS uid) = owner_id));

alter policy "owners update cars" on public.cars
  using ((( SELECT auth.uid() AS uid) = owner_id))
  with check ((( SELECT auth.uid() AS uid) = owner_id));

alter policy "users read own unreads" on public.conversation_unreads
  using ((( SELECT auth.uid() AS uid) = user_id));

alter policy "participants read conversations" on public.conversations
  using (((( SELECT auth.uid() AS uid) = participant_a) OR (( SELECT auth.uid() AS uid) = participant_b)));

alter policy "participants read dispute evidence" on public.dispute_evidence
  using ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = dispute_evidence.order_id) AND ((( SELECT auth.uid() AS uid) = o.buyer_id) OR (( SELECT auth.uid() AS uid) = o.seller_id))))));

alter policy "target owners read follows" on public.follows
  using ((((target_type = 'profile'::text) AND (target_id = ( SELECT auth.uid() AS uid))) OR ((target_type = 'car'::text) AND (EXISTS ( SELECT 1
   FROM public.cars c
  WHERE ((c.id = follows.target_id) AND (c.owner_id = ( SELECT auth.uid() AS uid))))))));

alter policy "users manage own follows" on public.follows
  using ((( SELECT auth.uid() AS uid) = follower_id))
  with check ((( SELECT auth.uid() AS uid) = follower_id));

alter policy "users manage own likes" on public.likes
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check ((( SELECT auth.uid() AS uid) = user_id));

alter policy "fitment follows listing" on public.listing_fitments
  using ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = listing_fitments.listing_id) AND ((l.status = ANY (ARRAY['active'::text, 'reserved'::text, 'sold'::text])) OR (l.seller_id = ( SELECT auth.uid() AS uid)))))));

alter policy "sellers manage fitment" on public.listing_fitments
  using ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = listing_fitments.listing_id) AND (l.seller_id = ( SELECT auth.uid() AS uid))))))
  with check ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = listing_fitments.listing_id) AND (l.seller_id = ( SELECT auth.uid() AS uid))))));

alter policy "sellers manage listing images" on public.listing_images
  using ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = listing_images.listing_id) AND (l.seller_id = ( SELECT auth.uid() AS uid))))))
  with check ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = listing_images.listing_id) AND (l.seller_id = ( SELECT auth.uid() AS uid))))));

alter policy "own listing imports" on public.listing_imports
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));

alter policy "listing part numbers follow listing" on public.listing_part_numbers
  using ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = listing_part_numbers.listing_id) AND ((l.status = ANY (ARRAY['active'::text, 'reserved'::text, 'sold'::text])) OR (l.seller_id = ( SELECT auth.uid() AS uid)))))));

alter policy "sellers manage listing part numbers" on public.listing_part_numbers
  using ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = listing_part_numbers.listing_id) AND (l.seller_id = ( SELECT auth.uid() AS uid))))))
  with check ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = listing_part_numbers.listing_id) AND (l.seller_id = ( SELECT auth.uid() AS uid))))));

alter policy "authed users ask questions" on public.listing_questions
  with check (((( SELECT auth.uid() AS uid) = author_id) AND ((char_length(body) >= 1) AND (char_length(body) <= 2000)) AND (EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = listing_questions.listing_id) AND ((l.status = ANY (ARRAY['active'::text, 'sold'::text])) OR (l.seller_id = ( SELECT auth.uid() AS uid)))))) AND ((parent_id IS NULL) OR public.listing_question_parent_matches(parent_id, listing_id))));

alter policy "authors delete questions" on public.listing_questions
  using ((( SELECT auth.uid() AS uid) = author_id));

alter policy "questions follow listing visibility" on public.listing_questions
  using ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = listing_questions.listing_id) AND ((l.status = ANY (ARRAY['active'::text, 'reserved'::text, 'sold'::text])) OR (l.seller_id = ( SELECT auth.uid() AS uid)))))));

alter policy "suspended members don't ask" on public.listing_questions
  with check ((NOT ( SELECT public.is_suspended(( SELECT auth.uid() AS uid)) AS is_suspended)));

alter policy "sellers delete listings" on public.listings
  using ((( SELECT auth.uid() AS uid) = seller_id));

alter policy "sellers insert listings" on public.listings
  with check (((( SELECT auth.uid() AS uid) = seller_id) AND (NOT ( SELECT public.is_suspended(( SELECT auth.uid() AS uid)) AS is_suspended))));

alter policy "sellers update listings" on public.listings
  using ((( SELECT auth.uid() AS uid) = seller_id))
  with check ((( SELECT auth.uid() AS uid) = seller_id));

alter policy "participants read messages" on public.messages
  using ((((( SELECT auth.uid() AS uid) = sender_id) OR (( SELECT auth.uid() AS uid) = recipient_id)) OR ( SELECT public.is_admin() AS is_admin)));

alter policy "recipients update own messages" on public.messages
  using ((( SELECT auth.uid() AS uid) = recipient_id))
  with check ((( SELECT auth.uid() AS uid) = recipient_id));

alter policy "senders create messages" on public.messages
  with check (((( SELECT auth.uid() AS uid) = sender_id) AND (( SELECT auth.uid() AS uid) IS DISTINCT FROM recipient_id) AND (((order_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = messages.order_id) AND ((( SELECT auth.uid() AS uid) = o.buyer_id) OR (( SELECT auth.uid() AS uid) = o.seller_id)) AND ((messages.recipient_id = o.buyer_id) OR (messages.recipient_id = o.seller_id)))))) OR ((offer_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM (public.offers f
     JOIN public.listings l ON ((l.id = f.listing_id)))
  WHERE ((f.id = messages.offer_id) AND ((( SELECT auth.uid() AS uid) = f.buyer_id) OR (( SELECT auth.uid() AS uid) = l.seller_id)) AND ((messages.recipient_id = f.buyer_id) OR (messages.recipient_id = l.seller_id)))))) OR ((order_id IS NULL) AND (offer_id IS NULL) AND (EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = messages.listing_id) AND (l.status = ANY (ARRAY['active'::text, 'sold'::text])) AND (messages.recipient_id = l.seller_id))))))));

alter policy "suspended members don't message" on public.messages
  with check ((NOT ( SELECT public.is_suspended(( SELECT auth.uid() AS uid)) AS is_suspended)));

alter policy "mods follow car visibility" on public.mod_items
  using ((EXISTS ( SELECT 1
   FROM public.cars c
  WHERE ((c.id = mod_items.car_id) AND (c.is_public OR (c.owner_id = ( SELECT auth.uid() AS uid)))))));

alter policy "owners manage mods" on public.mod_items
  using ((EXISTS ( SELECT 1
   FROM public.cars c
  WHERE ((c.id = mod_items.car_id) AND (c.owner_id = ( SELECT auth.uid() AS uid))))))
  with check ((EXISTS ( SELECT 1
   FROM public.cars c
  WHERE ((c.id = mod_items.car_id) AND (c.owner_id = ( SELECT auth.uid() AS uid))))));

alter policy "users delete own notifications" on public.notifications
  using ((( SELECT auth.uid() AS uid) = user_id));

alter policy "users read own notifications" on public.notifications
  using ((( SELECT auth.uid() AS uid) = user_id));

alter policy "users update own notifications" on public.notifications
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check ((( SELECT auth.uid() AS uid) = user_id));

alter policy "buyers create offers" on public.offers
  with check ((( SELECT auth.uid() AS uid) = buyer_id));

alter policy "buyers withdraw own offers" on public.offers
  using (((( SELECT auth.uid() AS uid) = buyer_id) AND (status = ANY (ARRAY['open'::text, 'countered'::text]))))
  with check (((( SELECT auth.uid() AS uid) = buyer_id) AND (status = 'withdrawn'::text)));

alter policy "participants read offers" on public.offers
  using (((( SELECT auth.uid() AS uid) = buyer_id) OR (EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = offers.listing_id) AND (l.seller_id = ( SELECT auth.uid() AS uid))))) OR ( SELECT public.is_admin() AS is_admin)));

alter policy "suspended members don't make offers" on public.offers
  with check ((NOT ( SELECT public.is_suspended(( SELECT auth.uid() AS uid)) AS is_suspended)));

alter policy "admins read cases" on public.ops_cases
  using (( SELECT public.is_admin() AS is_admin));

alter policy "participants read snapshot images" on public.order_item_snapshot_images
  using ((EXISTS ( SELECT 1
   FROM (public.order_items oi
     JOIN public.orders o ON ((o.id = oi.order_id)))
  WHERE ((oi.id = order_item_snapshot_images.order_item_id) AND (((( SELECT auth.uid() AS uid) = o.buyer_id) OR (( SELECT auth.uid() AS uid) = o.seller_id)) OR ( SELECT public.is_admin() AS is_admin))))));

alter policy "participants read order items" on public.order_items
  using ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_items.order_id) AND (((( SELECT auth.uid() AS uid) = o.buyer_id) OR (( SELECT auth.uid() AS uid) = o.seller_id)) OR ( SELECT public.is_admin() AS is_admin))))));

alter policy "participants read orders" on public.orders
  using ((((( SELECT auth.uid() AS uid) = buyer_id) OR (( SELECT auth.uid() AS uid) = seller_id)) OR ( SELECT public.is_admin() AS is_admin)));

alter policy "admins read payment recoveries" on public.payment_recoveries
  using (( SELECT public.is_admin() AS is_admin));

alter policy "participants read payments" on public.payments
  using ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = payments.order_id) AND (((( SELECT auth.uid() AS uid) = o.buyer_id) OR (( SELECT auth.uid() AS uid) = o.seller_id)) OR ( SELECT public.is_admin() AS is_admin))))));

alter policy "users update own profile" on public.profiles
  using ((( SELECT auth.uid() AS uid) = id))
  with check ((( SELECT auth.uid() AS uid) = id));

alter policy "admins read refund lifecycle adjustments" on public.refund_lifecycle_adjustments
  using (( SELECT public.is_admin() AS is_admin));

alter policy "admins read refund operations" on public.refund_operations
  using (( SELECT public.is_admin() AS is_admin));

alter policy "admins read refund provider events" on public.refund_provider_events
  using (( SELECT public.is_admin() AS is_admin));

alter policy "reporters and admins read reports" on public.reports
  using (((( SELECT auth.uid() AS uid) = reporter_id) OR ( SELECT public.is_admin() AS is_admin)));

alter policy "users file reports" on public.reports
  with check ((( SELECT auth.uid() AS uid) = reporter_id));

alter policy "participants read return items" on public.return_items
  using ((EXISTS ( SELECT 1
   FROM (public.returns r
     JOIN public.orders o ON ((o.id = r.order_id)))
  WHERE ((r.id = return_items.return_id) AND (((( SELECT auth.uid() AS uid) = o.buyer_id) OR (( SELECT auth.uid() AS uid) = o.seller_id)) OR ( SELECT public.is_admin() AS is_admin))))));

alter policy "participants read returns" on public.returns
  using ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = returns.order_id) AND (((( SELECT auth.uid() AS uid) = o.buyer_id) OR (( SELECT auth.uid() AS uid) = o.seller_id)) OR ( SELECT public.is_admin() AS is_admin))))));

alter policy "authors delete reviews" on public.reviews
  using ((( SELECT auth.uid() AS uid) = reviewer_id));

alter policy "authors update reviews" on public.reviews
  using ((( SELECT auth.uid() AS uid) = reviewer_id))
  with check ((( SELECT auth.uid() AS uid) = reviewer_id));

alter policy "reviewers create reviews" on public.reviews
  with check (((( SELECT auth.uid() AS uid) = reviewer_id) AND (reviewer_id IS DISTINCT FROM reviewee_id) AND (EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = reviews.order_id) AND ((( SELECT auth.uid() AS uid) = o.buyer_id) OR (( SELECT auth.uid() AS uid) = o.seller_id)) AND (reviews.reviewee_id =
        CASE
            WHEN (( SELECT auth.uid() AS uid) = o.buyer_id) THEN o.seller_id
            ELSE o.buyer_id
        END) AND (o.status = ANY (ARRAY['delivered'::text, 'completed'::text])))))));

alter policy "own saved searches" on public.saved_searches
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));

alter policy "target owners read saves" on public.saves
  using ((((target_type = 'profile'::text) AND (target_id = ( SELECT auth.uid() AS uid))) OR ((target_type = 'car'::text) AND (EXISTS ( SELECT 1
   FROM public.cars c
  WHERE ((c.id = saves.target_id) AND (c.owner_id = ( SELECT auth.uid() AS uid)))))) OR ((target_type = 'listing'::text) AND (EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = saves.target_id) AND (l.seller_id = ( SELECT auth.uid() AS uid))))))));

alter policy "users manage own saves" on public.saves
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check ((( SELECT auth.uid() AS uid) = user_id));

alter policy "seller reads own adjustments" on public.seller_adjustments
  using (((seller_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin)));

alter policy "seller reads own carry entries" on public.seller_carry_entries
  using (((seller_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin)));

alter policy "seller reads own carry payouts" on public.seller_carry_payouts
  using (((seller_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin)));

alter policy "owner reads fulfillment profile" on public.seller_fulfillment_profiles
  using (((seller_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin)));

alter policy "participants read shipment events" on public.shipment_events
  using ((EXISTS ( SELECT 1
   FROM (public.shipments s
     JOIN public.orders o ON ((o.id = s.order_id)))
  WHERE ((s.id = shipment_events.shipment_id) AND (((( SELECT auth.uid() AS uid) = o.buyer_id) OR (( SELECT auth.uid() AS uid) = o.seller_id)) OR ( SELECT public.is_admin() AS is_admin))))));

alter policy "participants read shipment items" on public.shipment_items
  using ((EXISTS ( SELECT 1
   FROM (public.shipments s
     JOIN public.orders o ON ((o.id = s.order_id)))
  WHERE ((s.id = shipment_items.shipment_id) AND (((( SELECT auth.uid() AS uid) = o.buyer_id) OR (( SELECT auth.uid() AS uid) = o.seller_id)) OR ( SELECT public.is_admin() AS is_admin))))));

alter policy "participants read shipments" on public.shipments
  using ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = shipments.order_id) AND (((( SELECT auth.uid() AS uid) = o.buyer_id) OR (( SELECT auth.uid() AS uid) = o.seller_id)) OR ( SELECT public.is_admin() AS is_admin))))));

alter policy "owners delete staged uploads" on public.staged_uploads
  using (((owner_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin)));

alter policy "owners insert staged uploads" on public.staged_uploads
  with check ((owner_id = ( SELECT auth.uid() AS uid)));

alter policy "owners read staged uploads" on public.staged_uploads
  using (((owner_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin)));

alter policy "owners update staged uploads" on public.staged_uploads
  using (((owner_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin)))
  with check (((owner_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin)));

alter policy "admins read transfer intents" on public.transfer_intents
  using (( SELECT public.is_admin() AS is_admin));

alter policy "admins read webhook events" on public.webhook_events
  using (( SELECT public.is_admin() AS is_admin));

commit;
