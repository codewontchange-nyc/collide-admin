-- bugsweep sql hardening. Applied live 2026-09-09 (recorded post-hoc; see README).
-- Bug sweep — SQL security/correctness hardening.
-- 1) Moderation "hide" bypass: event_invite_preview + join_event are SECURITY
--    DEFINER, so the restrictive mod_hide_activities RLS policy never applies
--    inside them. A staff-hidden PUBLIC event still previewed + joined via the
--    public share link. Add explicit is_hidden() checks.
-- 2) Add SET search_path to SECURITY DEFINER functions missing it (search-path
--    hijack hardening) via ALTER FUNCTION (no body change).
-- 3) Bind client_errors inserts to the caller (no impersonating another user's
--    profile_id) while still allowing anonymous/pre-login rows (profile_id null).
-- 4) Covering indexes on RLS-/join-hot FK columns that lacked one.
-- NOTE: dropping the dead push_subscriptions table is done separately, AFTER the
--       admin console is switched to push_subs.

-- 1a. event_invite_preview — hidden public events must not preview
create or replace function public.event_invite_preview(eid uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'event', jsonb_build_object(
      'id', a.id, 'title', a.title, 'date', a.date, 'at_time', a.at_time,
      'place', coalesce(a.place, a.location), 'city', a.city,
      'category', a.category, 'image_path', a.image_path, 'note', a.note),
    'host', (select jsonb_build_object(
        'first_name', split_part(coalesce(p.display_name, 'A neighbor'), ' ', 1),
        'avatar_url', p.avatar_url)
      from profiles p where p.id = a.host_id),
    'going', jsonb_build_object(
      'count', (select count(*) from rsvps r where r.activity_id = a.id),
      'sample', coalesce((select jsonb_agg(jsonb_build_object(
          'first_name', split_part(coalesce(p.display_name, '?'), ' ', 1),
          'avatar_url', p.avatar_url))
        from (select r.profile_id from rsvps r where r.activity_id = a.id
              order by r.created_at limit 8) s
        join profiles p on p.id = s.profile_id), '[]'::jsonb)),
    'community', case when a.community_id is null then null
                 else community_preview(a.community_id) end)
  from activities a
  where a.id = eid and a.visibility = 'public'
    and not is_hidden('activities', a.id)
    and (a.date >= current_date
         or (a.date is null and (a.expires_at is null or a.expires_at > now())));
$function$;

-- 1b. join_event — cannot RSVP/join a hidden public event
create or replace function public.join_event(eid uuid, join_comm boolean default true, via text default null::text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); a record; st text; existing text; vouched boolean := false;
begin
  if uid is null then return json_build_object('error', 'auth'); end if;
  select id, title, community_id into a from activities
    where id = eid and visibility = 'public'
      and not is_hidden('activities', id)
      and (date >= current_date or (date is null and (expires_at is null or expires_at > now())));
  if a.id is null then return json_build_object('error', 'not_found'); end if;

  insert into rsvps (activity_id, profile_id, source)
    values (eid, uid, case when coalesce(via, '') <> '' then 'invite:' || via else 'invite' end)
    on conflict (activity_id, profile_id) do nothing;

  if join_comm and a.community_id is not null then
    select status into existing from community_members
      where community_id = a.community_id and profile_id = uid;
    if existing is not null then
      st := existing;
    else
      -- NOTE (intended by product): a member's public connect_code carried in the
      -- invite link vouches the invitee straight to 'member'. The code is not a
      -- secret, so a shared/leaked link grants auto-join — accepted growth trade-off.
      if coalesce(via, '') <> '' then
        select true into vouched from profiles p
          join community_members m on m.profile_id = p.id
            and m.community_id = a.community_id and m.status = 'member'
          where p.connect_code = via limit 1;
      end if;
      st := case when vouched then 'member' else 'pending' end;
      insert into community_members (community_id, profile_id, status)
        values (a.community_id, uid, st) on conflict do nothing;
    end if;
  end if;

  return json_build_object('ok', true, 'event_id', a.id, 'title', a.title,
    'community_id', a.community_id, 'community_status', st);
end $function$;

-- 2. search_path hardening (no body change)
alter function public.ed_act_city(uuid)        set search_path to 'public';
alter function public.ed_ann_chatcard()        set search_path to 'public';
alter function public.ed_ann_stamp_staff()     set search_path to 'public';
alter function public.ed_comm_city(uuid)       set search_path to 'public';
alter function public.ed_dm_start(uuid, text)  set search_path to 'public';
alter function public.ed_event_chatcard()      set search_path to 'public';
alter function public.ed_join_global(uuid)     set search_path to 'public';
alter function public.ed_sync_pin_expiry()     set search_path to 'public';

-- 3. client_errors: no impersonation, still allow anon/pre-login rows
alter policy ce_ins on public.client_errors
  with check (profile_id = auth.uid() or profile_id is null);

-- 4. covering indexes on hot FK / RLS-predicate columns
create index if not exists idx_community_members_profile on public.community_members(profile_id);
create index if not exists idx_connections_b              on public.connections(b);
create index if not exists idx_connections_requested_by   on public.connections(requested_by);
create index if not exists idx_dm_messages_thread         on public.dm_messages(thread_id);
create index if not exists idx_staff_profile              on public.staff(profile_id);
create index if not exists idx_staff_community            on public.staff(community_id);
create index if not exists idx_makers_city                on public.makers(city);
create index if not exists idx_rsvps_profile              on public.rsvps(profile_id);
