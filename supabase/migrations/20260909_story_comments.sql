-- story comments. Applied live 2026-09-09 (recorded post-hoc; see README).
-- Comments on Up Next journal posts (stories). Supports both end-of-article
-- comments (quote null) and highlight-to-comment (quote = the selected text,
-- quote_start/len = char offsets into the plaintext body for re-highlighting).
create table if not exists public.story_comments (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null,
  quote text,
  quote_start int,
  quote_len int,
  created_at timestamptz not null default now()
);
create index if not exists idx_story_comments_story on public.story_comments(story_id, created_at);
alter table public.story_comments enable row level security;

-- read: anyone who can see the story (published + in their city) or staff
create policy scmt_sel on public.story_comments for select to authenticated using (
  exists (select 1 from public.stories s where s.id = story_id
    and (s.published or is_any_staff())
    and (s.city = req_city() or (req_city_raw() is null and is_any_staff())))
);
-- write: signed-in user, on a published story in their city, as themselves
create policy scmt_ins on public.story_comments for insert to authenticated with check (
  author_id = auth.uid()
  and exists (select 1 from public.stories s where s.id = story_id and s.published and s.city = req_city())
);
-- author or staff can remove
create policy scmt_del on public.story_comments for delete to authenticated using (
  author_id = auth.uid() or is_any_staff()
);
