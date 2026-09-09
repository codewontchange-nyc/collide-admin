-- Expand the maker role: active makers may post a city-wide Up Next announcement.
-- Previously only staff could post to the city feed (community_id IS NULL);
-- members could only post into their own community/circle. Makers are vetted
-- local providers, so we let an ACTIVE maker broadcast to the Up Next feed of
-- the city they're a maker in (req_city() == the city stamped on the row).

create or replace function public.is_active_maker()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists(
    select 1 from makers m
    where m.profile_id = auth.uid()
      and m.active = true
      and m.city = req_city()
  );
$function$;

-- Let an active maker insert a city-wide announcement (community_id IS NULL).
-- Keeps: author must be self; staff keep global reach; members keep circle reach.
alter policy ann_ins on public.announcements
  with check (
    (author_id = auth.uid()) and (
      is_any_staff()
      or (community_id is not null and is_community_member(community_id))
      or (community_id is null and is_active_maker())
    )
  );
