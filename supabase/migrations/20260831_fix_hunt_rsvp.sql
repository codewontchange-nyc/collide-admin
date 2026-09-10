-- Hunt RSVP fix. Applied live 2026-08-31.
--
-- Community events placed on the shared map (hunts included) are visible to
-- the whole city (act_sel's on_shared_map arm), but can_see_activity() —
-- the WITH CHECK gate on rsvp_ins — only honored map placement for GLOBAL
-- events. So a non-member could see a hunt on the map, tap "I'm in", and be
-- refused by RLS. Align the join gate with the visibility gate: on the map
-- + public (or global, as before) = joinable.
create or replace function can_see_activity(aid uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as
$$
  select exists(
    select 1 from activities a where a.id = aid and (
      a.host_id = uid
      or are_connected(a.host_id, uid)
      or exists(select 1 from rsvps r where r.activity_id = a.id and r.profile_id = uid)
      or (a.community_id is not null and is_community_member(a.community_id, uid))
      or (exists(select 1 from map_events me where me.activity_id = a.id)
          and (a.visibility = 'public' or a.community_id is null))
    ));
$$;
