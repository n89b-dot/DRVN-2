alter table public.profiles add column if not exists notification_prefs jsonb not null default '{}'::jsonb;
