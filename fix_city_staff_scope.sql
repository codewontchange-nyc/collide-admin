-- Fix, 2026-08-30: staff city-filter bypass leaked cross-city pins in the APP.
--
-- The staff exemption added for the console (which sends no x-collide-city
-- header) also bypassed city scoping for staff INSIDE the app (which does
-- send the header) — so a staff member swapping NYC↔ATL saw both cities'
-- pins combined. New rule: the header, when present, scopes EVERYONE;
-- staff-see-everything applies only to headerless (console) requests.

create or replace function public.req_city_raw() returns text
language sql stable as $$
  select nullif(current_setting('request.headers', true)::json->>'x-collide-city', '');
$$;

drop policy if exists activities_city_r on activities;
create policy activities_city_r on activities as restrictive for select to authenticated
  using (city = req_city() or (req_city_raw() is null and is_any_staff()));
drop policy if exists announcements_city_r on announcements;
create policy announcements_city_r on announcements as restrictive for select to authenticated
  using (city = req_city() or (req_city_raw() is null and is_any_staff()));
drop policy if exists communities_city_r on communities;
create policy communities_city_r on communities as restrictive for select to authenticated
  using (city = req_city() or (req_city_raw() is null and is_any_staff()));
drop policy if exists makers_city_r on makers;
create policy makers_city_r on makers as restrictive for select to authenticated
  using (city = req_city() or (req_city_raw() is null and is_any_staff()));
drop policy if exists map_events_city_r on map_events;
create policy map_events_city_r on map_events as restrictive for select to authenticated
  using (city = req_city() or (req_city_raw() is null and is_any_staff()));
drop policy if exists pois_city_r on pois;
create policy pois_city_r on pois as restrictive for select to authenticated
  using (city = req_city() or (req_city_raw() is null and is_any_staff()));
drop policy if exists yaps_city_r on yaps;
create policy yaps_city_r on yaps as restrictive for select to authenticated
  using (city = req_city() or (req_city_raw() is null and is_any_staff()));
drop policy if exists stories_city_r on stories;
create policy stories_city_r on stories as restrictive for select to authenticated
  using (city = req_city() or (req_city_raw() is null and is_any_staff()));
