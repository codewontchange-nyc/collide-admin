-- Close the app-vs-admin gaps.
-- 1) Moderation reach: DMs, journal comments, hunt reviews, meals become hideable/deletable.
-- 2) Staff can read the member-content tables the admin panel now surfaces.
-- 3) facilitators ⇄ staff: staff is the authority; the public listing is kept in step
--    (trigger + backfill), staff.profile_id is filled from auth, and the app's
--    permission check accepts either profile_id or email so the two can't drift.

-- ---------- 1. moderation reach ----------
do $$ declare cn text; begin
  select conname into cn from pg_constraint where conrelid='public.content_hidden'::regclass and contype='c';
  if cn is not null then execute format('alter table public.content_hidden drop constraint %I', cn); end if;
  alter table public.content_hidden add constraint content_hidden_tbl_check check (tbl = any (array[
    'activities','announcements','pois','yaps','community_messages','event_messages','makers',
    'dm_messages','story_comments','hunt_reviews','meals']));
end $$;

drop policy if exists mod_hide_dm_messages on public.dm_messages;
create policy mod_hide_dm_messages on public.dm_messages as restrictive for select using (is_any_staff() or not is_hidden('dm_messages', id));
drop policy if exists mod_hide_story_comments on public.story_comments;
create policy mod_hide_story_comments on public.story_comments as restrictive for select using (is_any_staff() or not is_hidden('story_comments', id));
drop policy if exists mod_hide_hunt_reviews on public.hunt_reviews;
create policy mod_hide_hunt_reviews on public.hunt_reviews as restrictive for select using (is_any_staff() or not is_hidden('hunt_reviews', id));
drop policy if exists mod_hide_meals on public.meals;
create policy mod_hide_meals on public.meals as restrictive for select using (is_any_staff() or not is_hidden('meals', id));

create or replace function public.mod_delete(t text, r uuid) returns void
language plpgsql security definer set search_path to 'public' as $function$
begin
  if not is_owner() then raise exception 'owners only'; end if;
  case t
    when 'activities'         then delete from activities where id = r;
    when 'announcements'      then delete from announcements where id = r;
    when 'pois'               then delete from pois where id = r;
    when 'yaps'               then delete from yaps where id = r;
    when 'community_messages' then delete from community_messages where id = r;
    when 'event_messages'     then delete from event_messages where id = r;
    when 'makers'             then delete from makers where profile_id = r;
    when 'dm_messages'        then delete from dm_messages where id = r;
    when 'story_comments'     then delete from story_comments where id = r;
    when 'hunt_reviews'       then delete from hunt_reviews where id = r;
    when 'meals'              then delete from meals where id = r;
    else raise exception 'unknown content table %', t;
  end case;
  delete from content_hidden where tbl = t and row_id = r;
end $function$;

-- ---------- 2. staff read access for the new admin surfaces ----------
drop policy if exists bk_staff_sel on public.bookings;        create policy bk_staff_sel on public.bookings for select to authenticated using (is_any_staff());
drop policy if exists dmt_staff_sel on public.dm_threads;     create policy dmt_staff_sel on public.dm_threads for select to authenticated using (is_any_staff());
drop policy if exists dmm_staff_sel on public.dm_messages;    create policy dmm_staff_sel on public.dm_messages for select to authenticated using (is_any_staff());
drop policy if exists conn_staff_sel on public.connections;   create policy conn_staff_sel on public.connections for select to authenticated using (is_any_staff());
drop policy if exists meals_staff_sel on public.meals;        create policy meals_staff_sel on public.meals for select to authenticated using (is_any_staff());
drop policy if exists mcook_staff_sel on public.meal_cooks;   create policy mcook_staff_sel on public.meal_cooks for select to authenticated using (is_any_staff());
drop policy if exists mclaims_staff_sel on public.meal_claims; create policy mclaims_staff_sel on public.meal_claims for select to authenticated using (is_any_staff());
drop policy if exists hr_staff_sel on public.hunt_reviews;    create policy hr_staff_sel on public.hunt_reviews for select to authenticated using (is_any_staff());

-- ---------- 3. facilitators ⇄ staff ----------
create unique index if not exists facilitators_profile_comm_uidx on public.facilitators(profile_id, community_id);

-- fill staff.profile_id wherever the person already exists
update public.staff s set profile_id = u.id from auth.users u
 where s.profile_id is null and lower(u.email) = lower(s.email);

-- and keep filling it on first sign-in (extends the existing invite-accept trigger fn)
create or replace function public.mark_invite_accepted() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.last_sign_in_at is not null
     and (old.last_sign_in_at is null or new.last_sign_in_at > old.last_sign_in_at) then
    update invites set accepted_at = coalesce(accepted_at, now())
      where lower(email) = lower(new.email) and accepted_at is null;
    update staff set profile_id = new.id
      where profile_id is null and lower(email) = lower(new.email);
  end if;
  return new;
end $function$;

-- a staff facilitator always has a listing row (inactive stub until they fill it in);
-- removing the staff key retires the listing instead of orphaning it
create or replace function public.sync_facilitator_listing() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
begin
  if tg_op in ('INSERT','UPDATE') then
    if new.role = 'facilitator' and new.profile_id is not null and new.community_id is not null then
      insert into facilitators (profile_id, community_id, active) values (new.profile_id, new.community_id, false)
      on conflict (profile_id, community_id) do nothing;
    end if;
    return new;
  else
    if old.role = 'facilitator' and old.profile_id is not null and old.community_id is not null then
      update facilitators set active = false where profile_id = old.profile_id and community_id = old.community_id;
    end if;
    return old;
  end if;
end $function$;
drop trigger if exists staff_sync_facilitator on public.staff;
create trigger staff_sync_facilitator after insert or update or delete on public.staff
  for each row execute function public.sync_facilitator_listing();

-- backfill listings for staff facilitators who never got one
insert into public.facilitators (profile_id, community_id, active)
select s.profile_id, s.community_id, false from public.staff s
 where s.role = 'facilitator' and s.profile_id is not null and s.community_id is not null
on conflict (profile_id, community_id) do nothing;

-- the app's permission check: accept profile_id OR email, so an email-keyed staff row works too
create or replace function public.ed_can_facilitate(cid uuid) returns boolean
language sql stable security definer set search_path to 'public' as $function$
 select exists(select 1 from communities c where c.id=cid and c.owner_id=auth.uid())
     or exists(select 1 from staff s
               where (s.profile_id=auth.uid() or lower(s.email)=staff_email())
                 and s.role in ('owner','facilitator') and (s.community_id is null or s.community_id=cid))
$function$;

-- one roster for the admin: staff facilitators joined to their listing status (RLS of the caller applies)
create or replace view public.facilitator_roster as
select s.id as staff_id, s.email, s.community_id, s.profile_id, s.created_at as staff_since,
       p.display_name, p.avatar_url, f.headline, coalesce(f.active,false) as listing_active,
       (f.profile_id is not null) as has_listing
  from public.staff s
  left join public.profiles p on p.id = s.profile_id
  left join public.facilitators f on f.profile_id = s.profile_id and f.community_id = s.community_id
 where s.role = 'facilitator';
alter view public.facilitator_roster set (security_invoker = true);
