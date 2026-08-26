-- Up Next stories, 2026-08-26
--
-- Editorial journal entries staff write to the community at large — text,
-- images, an embedded video — surfaced in the app's Up next feed per city.
-- MVP: plain-text body (blank line = paragraph), images[] (first = cover,
-- stored in the event-media bucket), one video URL. Drafts until published.

create table if not exists stories (
  id uuid primary key default gen_random_uuid(),
  city text not null default 'nyc',
  title text not null,
  body text,
  images text[] not null default '{}',
  video_url text,
  author_id uuid references profiles(id) on delete set null,
  published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stories_city_pub on stories (city, published, published_at desc);

alter table stories enable row level security;

-- members read what's published; staff (the city leaders) see drafts too
drop policy if exists stories_sel on stories;
create policy stories_sel on stories for select to authenticated
  using (published or is_any_staff());

-- staff author, edit, and take down
drop policy if exists stories_write on stories;
create policy stories_write on stories for all to authenticated
  using (is_any_staff()) with check (is_any_staff());

-- same city scoping as the rest of the app: members see their city,
-- the console (no city header) sees everything
drop policy if exists stories_city_r on stories;
create policy stories_city_r on stories as restrictive for select to authenticated
  using (city = req_city() or is_any_staff());
