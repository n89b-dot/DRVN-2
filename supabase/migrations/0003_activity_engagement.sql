-- Reactions + replies on activity posts (mockup ActivityDetailScreen).

create table public.activity_reactions (
  post_id uuid not null references public.activity_posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, emoji)
);

create table public.activity_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.activity_posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index activity_reactions_post_idx on public.activity_reactions (post_id);
create index activity_comments_post_idx on public.activity_comments (post_id);

alter table public.activity_reactions enable row level security;
alter table public.activity_comments enable row level security;

-- Reactions + comments on public build posts are public content.
create policy "reactions public read" on public.activity_reactions for select using (true);
create policy "users manage own reactions" on public.activity_reactions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "comments public read" on public.activity_comments for select using (true);
create policy "users create comments" on public.activity_comments for insert
  with check (auth.uid() = author_id);
create policy "authors delete comments" on public.activity_comments for delete
  using (auth.uid() = author_id);
