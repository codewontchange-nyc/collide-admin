-- Makers are assigned to their HOME city. Applied live 2026-08-31.
-- Three ATL residents had maker rows stamped nyc (wrong directory, invisible
-- at home). Backfill from profiles.home_city, then keep it assigned:
-- maker rows always carry the owner's home city, and a home-city change
-- moves their maker listing with them.

update makers m set city = p.home_city
from profiles p
where p.id = m.profile_id and p.home_city is not null
  and m.city is distinct from p.home_city;

create or replace function set_maker_city() returns trigger
language plpgsql security definer set search_path = public as $$
declare hc text;
begin
  select home_city into hc from profiles where id = new.profile_id;
  new.city := coalesce(hc, new.city, 'nyc');
  return new;
end $$;
drop trigger if exists makers_home_city on makers;
create trigger makers_home_city before insert or update on makers
  for each row execute function set_maker_city();

create or replace function sync_maker_city() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.home_city is not null and new.home_city is distinct from old.home_city then
    update makers set city = new.home_city where profile_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists profiles_maker_city on profiles;
create trigger profiles_maker_city after update of home_city on profiles
  for each row execute function sync_maker_city();
