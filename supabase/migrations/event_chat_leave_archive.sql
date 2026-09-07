-- Event chat: leave + 48-hour archive. Applied live 2026-09-07.
--
-- 1) Leaving a chat is its own act — quitting the event (rsvp delete) stays
--    separate so attendance history survives. rsvps.left_chat_at marks it;
--    the existing rsvp_upd policy (profile_id = auth.uid()) already lets
--    members set/clear their own, so rejoin is possible.
alter table rsvps add column if not exists left_chat_at timestamptz;

-- 2) One clock both sides agree on: the chat closes 48h after the event —
--    end of the event day in the event's city (DST-aware) + 48h for dated
--    events, expires_at + 48h for date-less plans, never for evergreen
--    (no date, no expiry — the hunts). The app reads this for the countdown
--    via rpc; RLS enforces it below.
create or replace function event_chat_closes_at(aid uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select case
    when a.date is not null then
      ((a.date + 1)::timestamp at time zone
        case when coalesce(a.city, 'nyc') in ('chi', 'nola') then 'America/Chicago'
             when coalesce(a.city, 'nyc') in ('la', 'sf') then 'America/Los_Angeles'
             else 'America/New_York' end)
      + interval '48 hours'
    when a.expires_at is not null then a.expires_at + interval '48 hours'
    else null
  end
  from activities a where a.id = aid
$$;

-- was: expires_at + 3 days. Now the 48h archive is the rule.
drop policy if exists ev_msg_not_closed on event_messages;
create policy ev_msg_archived_48h on event_messages as restrictive for insert
  with check (coalesce(now() < event_chat_closes_at(activity_id), true));
