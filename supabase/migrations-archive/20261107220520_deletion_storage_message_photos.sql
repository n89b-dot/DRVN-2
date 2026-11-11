-- OS-W34 N16 follow-up: the deletion worker now drains the member's own
-- `message-photos` folder (`<sender>/<recipient>/<file>`), once the scrub has
-- cleared their messages' attachments, so only photos still referenced
-- elsewhere (dispute evidence) are kept. deletion_storage_tasks only allowed
-- the four public media buckets, so the worker's first checkpoint for the new
-- bucket was refused (tests/operations/deletion.test.ts). This widens the
-- check to the five buckets the worker drains; nothing else changes.
begin;

alter table public.deletion_storage_tasks
  drop constraint if exists deletion_storage_tasks_bucket_check;
alter table public.deletion_storage_tasks
  add constraint deletion_storage_tasks_bucket_check
  check (bucket in ('avatars', 'car-images', 'activity-images', 'listing-images', 'message-photos'));

commit;
