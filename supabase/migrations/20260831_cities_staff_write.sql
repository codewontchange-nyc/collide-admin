-- Console keeps cities.map_image_path in sync with map_config on artwork
-- upload; staff need update rights (cities was select-only). Applied live 2026-08-31.
create policy cities_staff_upd on cities for update to authenticated
  using (is_any_staff()) with check (is_any_staff());
