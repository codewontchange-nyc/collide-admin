-- User bans, 2026-08-31
-- The ban record is email-keyed so it outlives account deletion and blocks
-- re-invites. The actual lockout is GoTrue's native banned_until (set by the
-- moderate edge function), which refuses all future sign-ins; the function
-- also revokes refresh tokens and strips memberships/staff/push.

create table if not exists bans (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  profile_id uuid,
  reason text,
  banned_by text,
  created_at timestamptz not null default now()
);
alter table bans enable row level security;
drop policy if exists bans_owner_sel on bans;
create policy bans_owner_sel on bans for select to authenticated using (is_owner());
-- writes only via the moderate function (service role)
