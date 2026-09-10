-- Event invite flow: public share links that convert. Applied live 2026-09-07.
-- Landing page (collide-site/e/) + share edge fn read event_invite_preview
-- anonymously; join_event executes the conversion (RSVP + optional vouched
-- community join) for both fresh signups and 1-tap members.

-- attribution: how did this RSVP arrive ('invite:<connect_code>' | 'invite' | null=in-app)
alter table rsvps add column if not exists source text;

-- Public landing data. The event uuid is the capability (same stance as the
-- ICS endpoint): public + unexpired only. Attendees exposed as avatar +
-- FIRST name only (Cam's call — this is an open webpage).
create or replace function event_invite_preview(eid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'event', jsonb_build_object(
      'id', a.id, 'title', a.title, 'date', a.date, 'at_time', a.at_time,
      'place', coalesce(a.place, a.location), 'city', a.city,
      'category', a.category, 'image_path', a.image_path, 'note', a.note),
    'host', (select jsonb_build_object(
        'first_name', split_part(coalesce(p.display_name, 'A neighbor'), ' ', 1),
        'avatar_url', p.avatar_url)
      from profiles p where p.id = a.host_id),
    'going', jsonb_build_object(
      'count', (select count(*) from rsvps r where r.activity_id = a.id),
      'sample', coalesce((select jsonb_agg(jsonb_build_object(
          'first_name', split_part(coalesce(p.display_name, '?'), ' ', 1),
          'avatar_url', p.avatar_url))
        from (select r.profile_id from rsvps r where r.activity_id = a.id
              order by r.created_at limit 8) s
        join profiles p on p.id = s.profile_id), '[]'::jsonb)),
    'community', case when a.community_id is null then null
                 else community_preview(a.community_id) end)
  from activities a
  where a.id = eid and a.visibility = 'public'
    and (a.date >= current_date
         or (a.date is null and (a.expires_at is null or a.expires_at > now())));
$$;
grant execute on function event_invite_preview(uuid) to anon, authenticated;

-- The conversion executor: RSVP + optional community join, atomic and
-- idempotent. `via` is the sharer's connect_code — if they're a member of
-- the hosting community, the link is the vouch (instant member, mirroring
-- join_community's semantics); otherwise the join lands pending.
create or replace function join_event(eid uuid, join_comm boolean default true, via text default null)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); a record; st text; existing text; vouched boolean := false;
begin
  if uid is null then return json_build_object('error', 'auth'); end if;
  select id, title, community_id into a from activities
    where id = eid and visibility = 'public'
      and (date >= current_date or (date is null and (expires_at is null or expires_at > now())));
  if a.id is null then return json_build_object('error', 'not_found'); end if;

  insert into rsvps (activity_id, profile_id, source)
    values (eid, uid, case when coalesce(via, '') <> '' then 'invite:' || via else 'invite' end)
    on conflict (activity_id, profile_id) do nothing;

  if join_comm and a.community_id is not null then
    select status into existing from community_members
      where community_id = a.community_id and profile_id = uid;
    if existing is not null then
      st := existing;
    else
      if coalesce(via, '') <> '' then
        select true into vouched from profiles p
          join community_members m on m.profile_id = p.id
            and m.community_id = a.community_id and m.status = 'member'
          where p.connect_code = via limit 1;
      end if;
      st := case when vouched then 'member' else 'pending' end;
      insert into community_members (community_id, profile_id, status)
        values (a.community_id, uid, st) on conflict do nothing;
    end if;
  end if;

  return json_build_object('ok', true, 'event_id', a.id, 'title', a.title,
    'community_id', a.community_id, 'community_status', st);
end $$;
grant execute on function join_event(uuid, boolean, text) to authenticated;
revoke execute on function join_event(uuid, boolean, text) from anon;

-- invite semantics: a PUBLIC event is joinable by anyone holding its link,
-- shared-map presence no longer required for the RSVP gate.
create or replace function can_see_activity(aid uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as
$$
  select exists(
    select 1 from activities a where a.id = aid and (
      a.host_id = uid
      or are_connected(a.host_id, uid)
      or exists(select 1 from rsvps r where r.activity_id = a.id and r.profile_id = uid)
      or (a.community_id is not null and is_community_member(a.community_id, uid))
      or a.visibility = 'public'
      or (a.community_id is null and exists(select 1 from map_events me where me.activity_id = a.id))
    ));
$$;
