-- Invite funnel + web push, 2026-08-25
-- (applied live; __PUSH_SECRET__ is substituted at apply time — the real
--  value lives in the edge function secrets and inside the DB trigger only)

-- ============ 1 · invite funnel ============
-- Every invite the edge function sends gets a row; accepted_at flips on the
-- invitee's first sign-in after the invite (auth.users trigger below).
create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  kind text not null check (kind in ('member', 'facilitator')),
  community_id uuid references communities(id) on delete cascade,
  invited_by text,
  sent_at timestamptz not null default now(),
  attempts int not null default 1,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique nulls not distinct (email, kind, community_id)
);
alter table invites enable row level security;
drop policy if exists inv_sel on invites;
create policy inv_sel on invites for select to authenticated
  using (is_owner() or (community_id is not null and is_staff(community_id)));
drop policy if exists inv_del on invites;
create policy inv_del on invites for delete to authenticated
  using (is_owner() or (community_id is not null and is_staff(community_id)));
-- inserts/updates come only from the invite edge function (service role)

create or replace function public.mark_invite_accepted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.last_sign_in_at is not null
     and (old.last_sign_in_at is null or new.last_sign_in_at > old.last_sign_in_at) then
    update invites set accepted_at = coalesce(accepted_at, now())
      where lower(email) = lower(new.email) and accepted_at is null;
  end if;
  return new;
end $$;
drop trigger if exists invite_accept on auth.users;
create trigger invite_accept after update on auth.users
  for each row execute function public.mark_invite_accepted();

-- ============ 2 · web push ============
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
drop policy if exists psub_own on push_subscriptions;
create policy psub_own on push_subscriptions for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- new announcement → push to its audience (community members, or everyone
-- for globals), no matter which surface posted it (app, console, Data tab)
create extension if not exists pg_net;
create or replace function public.push_on_announcement() returns trigger
language plpgsql security definer set search_path = public as $$
declare cname text;
begin
  if new.community_id is not null then
    select name into cname from communities where id = new.community_id;
  end if;
  perform net.http_post(
    url := 'https://pjxvvwcnjjizdtiutpxd.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-push-secret', '__PUSH_SECRET__'),
    body := jsonb_build_object(
      'title', coalesce(cname, 'Collide') || ' 📣',
      'body', left(new.body, 140),
      'community_id', new.community_id,
      'url', 'https://codewontchange-nyc.github.io/Collide/')
  );
  return new;
end $$;
drop trigger if exists announcement_push on announcements;
create trigger announcement_push after insert on announcements
  for each row execute function public.push_on_announcement();
