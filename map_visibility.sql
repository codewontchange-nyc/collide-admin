-- Map marker visibility, 2026-08-25
--
-- The rule: Collide itself can own markers (community_id IS NULL) and those
-- are public to every signed-in user. A community's markers are visible only
-- to its members (and staff). Ad-hoc friend pins on the map stay public;
-- pins that mirror a COMMUNITY event follow the community's visibility.
-- community_preview() feeds the community landing page safe aggregate stats
-- (member count, upcoming events, pin count + a teaser of pin names) without
-- exposing rows to non-members.

-- 1 · Collide-owned markers: allow pois without a community
alter table pois alter column community_id drop not null;

-- 2 · POI visibility: public when Collide-owned, else members/staff only.
--     (pois_public_sel USING(true) previously made every dot public.)
drop policy if exists pois_public_sel on pois;
drop policy if exists pois_sel on pois;
create policy pois_sel on pois for select to authenticated
  using (community_id is null
         or is_community_member(community_id)
         or is_staff(community_id));
-- pois_staff_sel (is_any_staff) stays: the console god view sees everything.

-- 3 · Map event pins: ad-hoc pins stay public; pins tied to a community
--     activity are members/staff-only.
drop policy if exists mapev_sel on map_events;
create policy mapev_sel on map_events for select to authenticated
  using (activity_id is null
         or exists (select 1 from activities a
                    where a.id = activity_id
                      and (a.community_id is null
                           or is_community_member(a.community_id)
                           or is_staff(a.community_id))));

-- 4 · Feed parity: being on the map only makes an activity public when it
--     has no community. (Before: any mapped activity was visible to all.)
create or replace function can_see_activity(aid uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists(
    select 1 from activities a where a.id = aid and (
      a.host_id = uid
      or are_connected(a.host_id, uid)
      or exists(select 1 from rsvps r where r.activity_id = a.id and r.profile_id = uid)
      or (a.community_id is not null and is_community_member(a.community_id, uid))
      or (a.community_id is null and exists(select 1 from map_events me where me.activity_id = a.id))
    ));
$$;

-- 5 · Community landing-page preview: safe aggregates for anyone, even
--     before joining (or signing up). No coordinates, no member identities.
create or replace function community_preview(cid uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'emoji', c.emoji,
    'description', c.description,
    'blurb', c.blurb,
    'image_path', c.image_path,
    'member_count', (select count(*) from community_members m
                     where m.community_id = c.id and m.status <> 'pending'),
    'upcoming_events', (select count(*) from activities a
                        where a.community_id = c.id
                          and (a.date >= current_date
                               or (a.date is null and (a.expires_at is null or a.expires_at > now())))),
    'pin_count', (select count(*) from pois p where p.community_id = c.id),
    'sample_pins', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'name', s.name, 'category', s.category, 'image_path', s.image_path))
       from (select name, category, image_path from pois
             where community_id = c.id order by created_at desc limit 6) s),
      '[]'::jsonb)
  )
  from communities c where c.id = cid;
$$;
grant execute on function community_preview(uuid) to authenticated, anon;

-- 6 · Writing Collide-owned markers: owners post as the platform;
--     community markers keep per-community staff gating.
drop policy if exists pois_write on pois;
create policy pois_write on pois for all to authenticated
  using ((community_id is null and is_owner()) or is_staff(community_id))
  with check ((community_id is null and is_owner()) or is_staff(community_id));
