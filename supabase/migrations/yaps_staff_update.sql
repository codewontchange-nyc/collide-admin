-- Let staff (admins/facilitators via is_any_staff) reposition Yaps on the admin
-- map. Yaps had no UPDATE policy at all, so nobody could move them. Scoped to
-- staff; regular users still only create/delete their own.
create policy yap_upd on public.yaps
  for update to authenticated
  using (is_any_staff())
  with check (is_any_staff());
