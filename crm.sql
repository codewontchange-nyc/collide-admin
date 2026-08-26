-- CRM + drip funnel, 2026-08-25
-- (__PUSH_SECRET__ substituted at apply time)
--
-- The funnel is DERIVED, never stored: stage 1 signed up → 2 joined/RSVP'd
-- → 3 in a circle → 4 yapping, each with its entry timestamp, computed from
-- rows that already exist. crm_campaigns holds the editable drip steps,
-- crm_touches remembers every nudge (spacing + history), and a pg_cron job
-- ticks the crm-tick edge function hourly.

-- ============ opt-out ============
alter table profiles add column if not exists crm_opt_out boolean not null default false;

-- ============ derived funnel ============
create or replace view crm_funnel as
select
  p.id,
  p.display_name,
  p.avatar_url,
  coalesce(p.home_city, 'nyc') as city,
  p.crm_opt_out,
  p.created_at as signed_up_at,
  s2.at as joined_at,
  s3.at as circled_at,
  s4.at as yapped_at,
  case when s4.at is not null then 4
       when s3.at is not null then 3
       when s2.at is not null then 2
       else 1 end as stage,
  coalesce(s4.at, s3.at, s2.at, p.created_at) as stage_entered_at
from profiles p
left join lateral (select least(
    (select min(m.joined_at) from community_members m where m.profile_id = p.id and m.status <> 'pending'),
    (select min(r.created_at) from rsvps r where r.profile_id = p.id)
  ) as at) s2 on true
left join lateral (select min(c.created_at) as at from connections c
  where (c.a = p.id or c.b = p.id) and coalesce(c.status, 'accepted') = 'accepted') s3 on true
left join lateral (select min(y.created_at) as at from yaps y where y.author_id = p.id) s4 on true;

-- the view is service-role/function territory — not for the public API
revoke all on crm_funnel from anon, authenticated;

-- ============ drip definitions (editable in the console) ============
create table if not exists crm_campaigns (
  id uuid primary key default gen_random_uuid(),
  stage int not null check (stage between 1 and 3),   -- users AT this stage, nudged toward the next
  step int not null,
  day_offset int not null default 1,                  -- days after entering the stage
  channel text not null default 'push' check (channel in ('push', 'email', 'both')),
  title text not null,
  body text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (stage, step)
);
alter table crm_campaigns enable row level security;
drop policy if exists crmc_owner on crm_campaigns;
create policy crmc_owner on crm_campaigns for all to authenticated
  using (is_owner()) with check (is_owner());

-- ============ touch log ============
create table if not exists crm_touches (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  campaign_id uuid references crm_campaigns(id) on delete set null,
  stage int, step int,
  channel text not null,
  title text, body text,
  sent_at timestamptz not null default now(),
  result text
);
create index if not exists crm_touches_profile on crm_touches (profile_id, sent_at desc);
alter table crm_touches enable row level security;
drop policy if exists crmt_staff_sel on crm_touches;
create policy crmt_staff_sel on crm_touches for select to authenticated using (is_any_staff());
-- writes come only from the crm-tick function (service role)

-- ============ console feed: staff-gated, includes emails ============
create or replace function crm_users()
returns table (
  id uuid, display_name text, avatar_url text, email text, city text,
  signed_up_at timestamptz, joined_at timestamptz, circled_at timestamptz, yapped_at timestamptz,
  stage int, stage_entered_at timestamptz,
  is_staff boolean, opt_out boolean,
  last_touch_at timestamptz, touches bigint
) language sql stable security definer set search_path = public as $$
  select f.id, f.display_name, f.avatar_url, u.email, f.city,
         f.signed_up_at, f.joined_at, f.circled_at, f.yapped_at,
         f.stage, f.stage_entered_at,
         exists(select 1 from staff s where lower(s.email) = lower(u.email)) as is_staff,
         f.crm_opt_out as opt_out,
         (select max(t.sent_at) from crm_touches t where t.profile_id = f.id) as last_touch_at,
         (select count(*) from crm_touches t where t.profile_id = f.id) as touches
  from crm_funnel f
  join auth.users u on u.id = f.id
  where is_any_staff()          -- non-staff callers get an empty set
  order by f.stage desc, f.stage_entered_at;
$$;
grant execute on function crm_users() to authenticated;

-- ============ default drip sequences (edit copy in the console) ============
insert into crm_campaigns (stage, step, day_offset, channel, title, body) values
  (1, 1, 1, 'push',  'Your map is waiting 🗺️', 'Hey {{name}} — the {{city}} map has hand-picked spots and plans happening this week. Come take a look.'),
  (1, 2, 3, 'email', 'Three things happening near you', 'Hi {{name}}, since you joined Collide: {{event}} is coming up, and communities in {{city}} are planning more. Tap in and RSVP to your first one.'),
  (1, 3, 7, 'both',  'Find your people in {{city}}', '{{name}}, communities on Collide are small on purpose. Join one this week — {{event}} is a great first hang.'),
  (2, 1, 2, 'push',  'You know these people now 👀', 'You RSVP''d — so did others. Add someone from {{community}} to your circle so you don''t lose track of them.'),
  (2, 2, 5, 'email', 'Circles make it stick', '{{name}}, members who add 1 person to their circle come back 3x more. Someone from {{community}} is one tap away.'),
  (3, 1, 2, 'push',  'Your circle can''t hear you 🗣️', 'Drop your first yap — tell your circle what you''re up to this week.'),
  (3, 2, 6, 'push',  'Got plans? Yap it.', '{{name}}, next time you''re heading somewhere, yap it first — that''s how plans on Collide start.')
on conflict (stage, step) do nothing;

-- ============ hourly tick ============
create extension if not exists pg_cron;
select cron.unschedule('crm-tick') where exists (select 1 from cron.job where jobname = 'crm-tick');
select cron.schedule('crm-tick', '15 * * * *', $$
  select net.http_post(
    url := 'https://pjxvvwcnjjizdtiutpxd.supabase.co/functions/v1/crm-tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', '__PUSH_SECRET__'),
    body := '{}'::jsonb)
$$);
