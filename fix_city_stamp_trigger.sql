-- Fix, 2026-08-30: set_req_city() forced city='nyc' on all console inserts.
--
-- The BEFORE INSERT triggers (activities, map_events, pois, yaps,
-- communities, announcements, makers) unconditionally stamped
-- new.city := req_city(). The app always sends x-collide-city, so app
-- writes were fine — but the console sends no header, so req_city()
-- fell back to 'nyc' and every console-created pin/POI/event/community
-- landed on the NYC map regardless of the selected city.
--
-- New rule (mirrors the read-side): when the header is PRESENT it is
-- authoritative (app behavior unchanged, members can't spoof city in the
-- body); when ABSENT (console), the explicitly provided city survives.

create or replace function public.set_req_city()
returns trigger language plpgsql as $$
begin
  if req_city_raw() is not null then
    new.city := req_city();          -- app: header wins, same as before
  elsif new.city is null then
    new.city := 'nyc';               -- headerless with no value: default
  end if;                            -- headerless with a value: keep it
  return new;
end $$;
