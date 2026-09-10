-- Moderation suite: hide/restore any member-facing content without deleting
-- it, plus an owner-gated hard delete. Applied live 2026-08-31.
--
-- Model: one registry of hidden content. Restrictive RLS policies on each
-- content table subtract hidden rows from every member read, while staff
-- keep seeing them (the console needs to manage what it hid). Nothing about
-- the additive city/community model changes.

create table if not exists content_hidden (
  tbl text not null check (tbl in
    ('activities','announcements','pois','yaps','community_messages','event_messages','makers')),
  row_id uuid not null,
  reason text,
  hidden_by text,
  hidden_at timestamptz not null default now(),
  primary key (tbl, row_id)
);
alter table content_hidden enable row level security;
create policy ch_staff_read  on content_hidden for select to authenticated using (is_any_staff());
create policy ch_owner_hide  on content_hidden for insert to authenticated with check (is_owner());
create policy ch_owner_unhide on content_hidden for delete to authenticated using (is_owner());

-- security definer so the check works inside policies on OTHER tables even
-- though members can't read content_hidden themselves
create or replace function is_hidden(t text, r uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from content_hidden where tbl = t and row_id = r) $$;

-- members never see hidden rows; staff still do
create policy mod_hide_activities on activities as restrictive for select
  using (is_any_staff() or not is_hidden('activities', id));
create policy mod_hide_announcements on announcements as restrictive for select
  using (is_any_staff() or not is_hidden('announcements', id));
create policy mod_hide_pois on pois as restrictive for select
  using (is_any_staff() or not is_hidden('pois', id));
create policy mod_hide_yaps on yaps as restrictive for select
  using (is_any_staff() or not is_hidden('yaps', id));
create policy mod_hide_community_messages on community_messages as restrictive for select
  using (is_any_staff() or not is_hidden('community_messages', id));
create policy mod_hide_event_messages on event_messages as restrictive for select
  using (is_any_staff() or not is_hidden('event_messages', id));
create policy mod_hide_makers on makers as restrictive for select
  using (is_any_staff() or not is_hidden('makers', profile_id));

-- owner-gated hard delete (the console's authenticated role has no delete
-- rights on member content otherwise, by design)
create or replace function mod_delete(t text, r uuid) returns void
language plpgsql security definer set search_path = public as $$
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
    else raise exception 'unknown content table %', t;
  end case;
  delete from content_hidden where tbl = t and row_id = r;
end $$;
revoke all on function mod_delete(text, uuid) from public, anon;
grant execute on function mod_delete(text, uuid) to authenticated;
