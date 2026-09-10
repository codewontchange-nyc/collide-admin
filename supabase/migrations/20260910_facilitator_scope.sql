-- Facilitator scope: a single-community facilitator writes only inside their community's city. Applied live 2026-09-10.
--
-- Before this, stories / map ink / city artwork / onboarding copy were
-- `is_any_staff()` writes, so a facilitator with one NYC community could
-- publish an Atlanta letter, replace Atlanta's map, or rewrite the platform's
-- onboarding copy. Reads stay staff-wide; writes now go through staff_city_ok().

-- owner, an all-community key, or a key on a community in that city
create or replace function public.staff_city_ok(c text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select is_owner()
      or exists (select 1 from staff s where lower(s.email) = staff_email() and s.community_id is null)
      or exists (select 1 from staff s join communities co on co.id = s.community_id
                 where lower(s.email) = staff_email() and co.city = c);
$$;

-- stories (Up Next letters): read any as staff, write only your city's
drop policy if exists stories_write on public.stories;
create policy stories_staff_sel on public.stories for select to authenticated using (is_any_staff());
create policy stories_ins on public.stories for insert to authenticated with check (staff_city_ok(city));
create policy stories_upd on public.stories for update to authenticated using (staff_city_ok(city)) with check (staff_city_ok(city));
create policy stories_del on public.stories for delete to authenticated using (staff_city_ok(city));

-- map ink + city artwork + the cities table's artwork pointer
drop policy if exists mdraw_ins on public.map_drawings; drop policy if exists mdraw_upd on public.map_drawings; drop policy if exists mdraw_del on public.map_drawings;
create policy mdraw_ins on public.map_drawings for insert to authenticated with check (staff_city_ok(city));
create policy mdraw_upd on public.map_drawings for update to authenticated using (staff_city_ok(city)) with check (staff_city_ok(city));
create policy mdraw_del on public.map_drawings for delete to authenticated using (staff_city_ok(city));
drop policy if exists mapcfg_ins on public.map_config; drop policy if exists mapcfg_upd on public.map_config;
create policy mapcfg_ins on public.map_config for insert to authenticated with check (staff_city_ok(city));
create policy mapcfg_upd on public.map_config for update to authenticated using (staff_city_ok(city)) with check (staff_city_ok(city));
drop policy if exists cities_staff_upd on public.cities;
create policy cities_staff_upd on public.cities for update to authenticated using (staff_city_ok(code)) with check (staff_city_ok(code));

-- yaps: staff may reposition/edit yaps in their own city (authors still own theirs)
drop policy if exists yap_upd on public.yaps;
create policy yap_upd on public.yaps for update to authenticated using (author_id = auth.uid() or staff_city_ok(city)) with check (author_id = auth.uid() or staff_city_ok(city));

-- onboarding canvas + live copy are platform-wide: staff read, owners write
drop policy if exists cvd_staff on public.canvas_docs;
create policy cvd_staff_sel on public.canvas_docs for select to authenticated using (is_any_staff());
create policy cvd_owner_write on public.canvas_docs for all to authenticated using (is_owner()) with check (is_owner());
drop policy if exists cvv_staff on public.canvas_versions;
create policy cvv_staff_sel on public.canvas_versions for select to authenticated using (is_any_staff());
create policy cvv_owner_write on public.canvas_versions for all to authenticated using (is_owner()) with check (is_owner());
drop policy if exists ocopy_write on public.onboarding_copy;
create policy ocopy_owner_write on public.onboarding_copy for all to authenticated using (is_owner()) with check (is_owner());

-- issues: a facilitator can clear errors from their own city; owners clear anything
drop policy if exists ce_del on public.client_errors;
create policy ce_del on public.client_errors for delete to authenticated using (is_owner() or (city is not null and staff_city_ok(city)));

-- staff: owner rows can't be deleted through the API at all (the console
-- already hides the button; this is the backstop for every other path)
create policy staff_owner_row_protect on public.staff as restrictive for delete to authenticated using (role <> 'owner');
