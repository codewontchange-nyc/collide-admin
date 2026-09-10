-- People tab: the god view gets one row per user, and the owner can edit
-- profile fields inline (profiles were self-update-only). Applied live 2026-08-31.
create policy profiles_owner_upd on profiles for update to authenticated
  using (is_owner()) with check (is_owner());
