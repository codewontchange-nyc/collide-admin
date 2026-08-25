-- Per-city maps in the console, 2026-08-25
--
-- map_config grows a city column (one artwork row per city; id=1 stays the
-- nyc row the app reads today). The admin Map view swaps between cities,
-- shows that city's pins, and uploads that city's artwork.
--
-- The console sends no x-collide-city header, so req_city() pins it to nyc.
-- The city-restrictive read filters get a staff exemption: members stay
-- city-scoped, staff see every city from the console.

alter table map_config drop constraint if exists map_config_singleton;  -- one row per CITY now
alter table map_config add column if not exists city text;
update map_config set city = 'nyc' where id = 1 and city is null;
create unique index if not exists map_config_city_key on map_config (city);
create sequence if not exists map_config_id_seq owned by map_config.id;
select setval('map_config_id_seq', (select coalesce(max(id), 1) from map_config));
alter table map_config alter column id set default nextval('map_config_id_seq');

-- seed Atlanta with the art already sitting in the map bucket
insert into map_config (city, image_path)
  select 'atl', 'atl-map.png'
  where not exists (select 1 from map_config where city = 'atl');

-- staff exemption on every city-restrictive filter
drop policy if exists activities_city_r on activities;
create policy activities_city_r on activities as restrictive for select to authenticated
  using (city = req_city() or is_any_staff());
drop policy if exists announcements_city_r on announcements;
create policy announcements_city_r on announcements as restrictive for select to authenticated
  using (city = req_city() or is_any_staff());
drop policy if exists communities_city_r on communities;
create policy communities_city_r on communities as restrictive for select to authenticated
  using (city = req_city() or is_any_staff());
drop policy if exists makers_city_r on makers;
create policy makers_city_r on makers as restrictive for select to authenticated
  using (city = req_city() or is_any_staff());
drop policy if exists map_events_city_r on map_events;
create policy map_events_city_r on map_events as restrictive for select to authenticated
  using (city = req_city() or is_any_staff());
drop policy if exists pois_city_r on pois;
create policy pois_city_r on pois as restrictive for select to authenticated
  using (city = req_city() or is_any_staff());
drop policy if exists yaps_city_r on yaps;
create policy yaps_city_r on yaps as restrictive for select to authenticated
  using (city = req_city() or is_any_staff());
