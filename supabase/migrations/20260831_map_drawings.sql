-- Map ink: staff draw on top of city map art in the console; the app can
-- overlay the compiled SVG. One row per city. Applied live 2026-08-31.
create table if not exists map_drawings (
  city text primary key,
  elements jsonb not null default '[]'::jsonb,   -- editable source (console)
  svg text,                                      -- compiled overlay (app renders this verbatim)
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table map_drawings enable row level security;
create policy mdraw_sel on map_drawings for select to authenticated using (true);
create policy mdraw_ins on map_drawings for insert to authenticated with check (is_any_staff());
create policy mdraw_upd on map_drawings for update to authenticated using (is_any_staff()) with check (is_any_staff());
create policy mdraw_del on map_drawings for delete to authenticated using (is_any_staff());
do $$ begin
  alter publication supabase_realtime add table map_drawings;
exception when duplicate_object then null; end $$;
