-- Community lifecycle: city assignment + archive, 2026-08-25
--
-- city: which city a community belongs to (app filters per-city).
-- archived_at: set → the community disappears from members' apps (community
-- row, its POIs, its announcements) but stays fully visible to staff in the
-- console for history and restore. Events/map pins expire on their own.

alter table communities add column if not exists city text not null default 'nyc';
alter table communities add column if not exists archived_at timestamptz;

create or replace function public.is_archived(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from communities c where c.id = cid and c.archived_at is not null);
$$;

-- members (and discovery) only see living communities; staff/owners see all
drop policy if exists comm_sel on communities;
create policy comm_sel on communities for select to authenticated
  using (archived_at is null or owner_id = auth.uid() or is_staff(id));

-- archived communities' POIs vanish for members, stay for staff
drop policy if exists pois_sel on pois;
create policy pois_sel on pois for select to authenticated
  using (community_id is null
         or is_staff(community_id)
         or (is_community_member(community_id) and not is_archived(community_id)));

-- same for their announcements
drop policy if exists ann_sel on announcements;
create policy ann_sel on announcements for select to authenticated
  using (community_id is null
         or is_staff(community_id)
         or (is_community_member(community_id) and not is_archived(community_id)));

-- landing preview carries city + archived so the app can 404 dead links
create or replace function community_preview(cid uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'emoji', c.emoji,
    'description', c.description,
    'blurb', c.blurb,
    'image_path', c.image_path,
    'city', c.city,
    'archived', c.archived_at is not null,
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
