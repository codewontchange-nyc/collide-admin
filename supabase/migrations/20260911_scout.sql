-- Scout: event ingestion — feed, watch list, runs, creator directory; city geo/tz. Applied live 2026-09-11.
--
-- Staff find events out there (pasted links, watched iCal/RSS/JSON-LD sources),
-- review them in one feed, and owners ingest chosen ones as public, city-wide
-- "Collide picks" hosted by the house profile. Item status is theirs: a re-fetch
-- never resurrects a dismissed item or forgets an ingested one.

-- cities get a center, a radius and a timezone (dates in the feed are LOCAL)
alter table public.cities
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists radius_km integer not null default 40,
  add column if not exists tz text not null default 'America/New_York';
update public.cities set lat=40.7128, lng=-74.0060, radius_km=40, tz='America/New_York' where code='nyc';
update public.cities set lat=33.7490, lng=-84.3880, radius_km=40, tz='America/New_York' where code='atl';
update public.cities set lat=34.0522, lng=-118.2437, radius_km=60, tz='America/Los_Angeles' where code='la';
update public.cities set lat=41.8781, lng=-87.6298, radius_km=40, tz='America/Chicago' where code='chi';
update public.cities set lat=37.7749, lng=-122.4194, radius_km=40, tz='America/Los_Angeles' where code='sf';
update public.cities set lat=29.9511, lng=-90.0715, radius_km=30, tz='America/Chicago' where code='nola';
update public.cities set lat=38.9072, lng=-77.0369, radius_km=35, tz='America/New_York' where code='dc';

-- the hand-drawn map may later carry lat/lng↔x/y anchors for auto-placement
alter table public.map_config add column if not exists calib jsonb;

create or replace function public.scout_touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ---------- watch list ----------
create table if not exists public.scout_sources (
  id uuid primary key default gen_random_uuid(),
  city text not null references public.cities(code),
  kind text not null check (kind in ('ics','rss','jsonld_page')),
  label text not null,
  url text not null,
  enabled boolean not null default true,
  interval_minutes integer not null default 180,
  default_category text,
  default_community_id uuid references public.communities(id) on delete set null,
  last_run_at timestamptz, last_ok_at timestamptz, last_error text, last_count integer,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists scout_sources_city_url on public.scout_sources (city, url);
create index if not exists scout_sources_due on public.scout_sources (enabled, last_run_at);

-- ---------- the feed ----------
create table if not exists public.scout_items (
  id uuid primary key default gen_random_uuid(),
  city text not null references public.cities(code),
  source text not null,                      -- generic | ics | rss | jsonld_page (api sources later)
  external_id text not null,                 -- ICS UID, or the canonical URL
  source_id uuid references public.scout_sources(id) on delete set null,
  url text not null,
  title text not null,
  description text,
  start_date date not null,                  -- LOCAL to the city's tz
  start_time time,                           -- LOCAL; null = time TBD
  starts_at timestamptz, ends_at timestamptz,
  venue_name text, address text, lat double precision, lng double precision,
  image_url text,
  price_min_cents integer, price_max_cents integer, currency text not null default 'USD',
  organizer_name text, organizer_url text,
  categories text[] not null default '{}',
  raw jsonb,
  fingerprint text not null,
  dupe_of uuid references public.scout_items(id) on delete set null,
  status text not null default 'new' check (status in ('new','saved','ingested','dismissed','expired')),
  activity_id uuid references public.activities(id) on delete set null,
  ingested_by uuid references public.profiles(id) on delete set null,
  ingested_at timestamptz,
  first_seen_at timestamptz not null default now(),
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists scout_items_ext on public.scout_items (source, external_id);
create index if not exists scout_items_feed on public.scout_items (city, status, start_date);
create index if not exists scout_items_fp on public.scout_items (city, fingerprint);
create index if not exists scout_items_activity on public.scout_items (activity_id) where activity_id is not null;
drop trigger if exists scout_items_touch on public.scout_items;
create trigger scout_items_touch before update on public.scout_items for each row execute function public.scout_touch_updated_at();

-- ---------- runs (cache + audit) ----------
create table if not exists public.scout_runs (
  id bigserial primary key,
  key text not null,
  kind text not null check (kind in ('search','refresh','extract','probe')),
  source_id uuid references public.scout_sources(id) on delete cascade,
  started_at timestamptz not null default now(), finished_at timestamptz,
  found integer, upserted integer, error text, by uuid
);
create index if not exists scout_runs_key on public.scout_runs (key, started_at desc);

-- ---------- creator directory (outreach) ----------
create table if not exists public.creators (
  id uuid primary key default gen_random_uuid(),
  city text not null references public.cities(code),
  name text not null,
  handle text,
  platform text not null default 'instagram' check (platform in ('instagram','tiktok','luma','eventbrite','partiful','meetup','substack','website','other')),
  profile_url text, followers integer, email text, phone text,
  tags text[] not null default '{}',
  notes text,
  status text not null default 'prospect' check (status in ('prospect','contacted','replied','onboarded','declined')),
  last_contact_at timestamptz,
  owner_email text,
  profile_id uuid references public.profiles(id) on delete set null,
  community_id uuid references public.communities(id) on delete set null,
  source_id uuid references public.scout_sources(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists creators_handle on public.creators (platform, lower(handle)) where handle is not null;
create index if not exists creators_city_status on public.creators (city, status);
drop trigger if exists creators_touch on public.creators;
create trigger creators_touch before update on public.creators for each row execute function public.scout_touch_updated_at();

-- ---------- RLS: staff read/write; owners delete sources + creators; runs read-only ----------
alter table public.scout_sources enable row level security;
alter table public.scout_items   enable row level security;
alter table public.scout_runs    enable row level security;
alter table public.creators      enable row level security;
drop policy if exists scout_sources_staff_rw on public.scout_sources;
create policy scout_sources_staff_rw on public.scout_sources for select to authenticated using (is_any_staff());
create policy scout_sources_staff_ins on public.scout_sources for insert to authenticated with check (is_any_staff());
create policy scout_sources_staff_upd on public.scout_sources for update to authenticated using (is_any_staff()) with check (is_any_staff());
create policy scout_sources_owner_del on public.scout_sources for delete to authenticated using (is_owner());
create policy scout_items_staff on public.scout_items for all to authenticated using (is_any_staff()) with check (is_any_staff());
create policy scout_runs_staff on public.scout_runs for select to authenticated using (is_any_staff());
create policy creators_staff_sel on public.creators for select to authenticated using (is_any_staff());
create policy creators_staff_ins on public.creators for insert to authenticated with check (is_any_staff());
create policy creators_staff_upd on public.creators for update to authenticated using (is_any_staff()) with check (is_any_staff());
create policy creators_owner_del on public.creators for delete to authenticated using (is_owner());
grant select, insert, update, delete on public.scout_sources, public.scout_items, public.creators to authenticated;
grant select on public.scout_runs to authenticated;
grant usage, select on sequence public.scout_runs_id_seq to authenticated;
