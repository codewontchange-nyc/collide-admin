-- CRM stage 0: the acquisition lane, 2026-08-25
--
-- Invited people get an account (and membership) at invite time, but until
-- they first sign in they're not really "users" — they're stage 0. The
-- funnel now separates them: never-signed-in profiles sit in "Invited",
-- aging from their invite, and get INVITE REMINDERS (re-sent sign-in links)
-- instead of product drips. The moment they sign in, mark_invite_accepted
-- flips their invite and they surface at their true stage.

-- widen the campaign lanes to include stage 0 (invited → signed in)
alter table crm_campaigns drop constraint if exists crm_campaigns_stage_check;
alter table crm_campaigns add constraint crm_campaigns_stage_check check (stage between 0 and 3);

-- funnel view: stage 0 = account exists, never signed in
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
  case when u.last_sign_in_at is null then 0
       when s4.at is not null then 4
       when s3.at is not null then 3
       when s2.at is not null then 2
       else 1 end as stage,
  case when u.last_sign_in_at is null then p.created_at
       else coalesce(s4.at, s3.at, s2.at, p.created_at) end as stage_entered_at,
  u.last_sign_in_at
from profiles p
join auth.users u on u.id = p.id
left join lateral (select least(
    (select min(m.joined_at) from community_members m where m.profile_id = p.id and m.status <> 'pending'),
    (select min(r.created_at) from rsvps r where r.profile_id = p.id)
  ) as at) s2 on true
left join lateral (select min(c.created_at) as at from connections c
  where (c.a = p.id or c.b = p.id) and coalesce(c.status, 'accepted') = 'accepted') s3 on true
left join lateral (select min(y.created_at) as at from yaps y where y.author_id = p.id) s4 on true;
revoke all on crm_funnel from anon, authenticated;

-- crm_users grows never_signed_in (return type change needs a drop)
drop function if exists crm_users();
create or replace function crm_users()
returns table (
  id uuid, display_name text, avatar_url text, email text, city text,
  signed_up_at timestamptz, joined_at timestamptz, circled_at timestamptz, yapped_at timestamptz,
  stage int, stage_entered_at timestamptz,
  is_staff boolean, opt_out boolean, never_signed_in boolean,
  last_touch_at timestamptz, touches bigint
) language sql stable security definer set search_path = public as $$
  select f.id, f.display_name, f.avatar_url, u.email, f.city,
         f.signed_up_at, f.joined_at, f.circled_at, f.yapped_at,
         f.stage, f.stage_entered_at,
         exists(select 1 from staff s where lower(s.email) = lower(u.email)) as is_staff,
         f.crm_opt_out as opt_out,
         f.last_sign_in_at is null as never_signed_in,
         (select max(t.sent_at) from crm_touches t where t.profile_id = f.id) as last_touch_at,
         (select count(*) from crm_touches t where t.profile_id = f.id) as touches
  from crm_funnel f
  join auth.users u on u.id = f.id
  where is_any_staff()
  order by f.stage desc, f.stage_entered_at;
$$;
grant execute on function crm_users() to authenticated;

-- default reminder cadence: day 2 and day 6 after the invite
insert into crm_campaigns (stage, step, day_offset, channel, title, body) values
  (0, 1, 2, 'email', 'Invite reminder #1', '(re-sends their invite sign-in link — copy comes from the invite email template)'),
  (0, 2, 6, 'email', 'Invite reminder #2', '(re-sends their invite sign-in link — copy comes from the invite email template)')
on conflict (stage, step) do nothing;
