-- Audit fixes, 2026-08-30

-- 1 · CRITICAL: any authenticated user could overwrite any city's map
--     artwork (mapcfg_ins/upd had WITH CHECK true). Staff only now.
drop policy if exists mapcfg_ins on map_config;
create policy mapcfg_ins on map_config for insert to authenticated
  with check (is_any_staff());
drop policy if exists mapcfg_upd on map_config;
create policy mapcfg_upd on map_config for update to authenticated
  using (is_any_staff()) with check (is_any_staff());

-- 2 · crm_users() exposed every user's email + funnel data to ANY staff;
--     the CRM page is owner-only — the data feed now matches.
create or replace function crm_users()
returns table (
  id uuid, display_name text, avatar_url text, email text, city text,
  signed_up_at timestamptz, joined_at timestamptz, circled_at timestamptz, yapped_at timestamptz,
  stage int, stage_entered_at timestamptz,
  is_staff boolean, opt_out boolean, never_signed_in boolean,
  last_touch_at timestamptz, touches bigint
) language sql stable security definer set search_path = public as $$
  select f.id, f.display_name, f.avatar_url, u.email, f.city,
         f.signed_up_at, f.joined_at, f.circled_at, f.yapped_at,
         f.stage, f.stage_entered_at,
         exists(select 1 from staff s where lower(s.email) = lower(u.email)) as is_staff,
         f.crm_opt_out as opt_out,
         f.last_sign_in_at is null as never_signed_in,
         (select max(t.sent_at) from crm_touches t where t.profile_id = f.id) as last_touch_at,
         (select count(*) from crm_touches t where t.profile_id = f.id) as touches
  from crm_funnel f
  join auth.users u on u.id = f.id
  where is_owner()          -- owners only, matching the console gate
  order by f.stage desc, f.stage_entered_at;
$$;
