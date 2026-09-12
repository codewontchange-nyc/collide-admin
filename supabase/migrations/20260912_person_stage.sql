-- Person page: an owner-only peek at a member's funnel stage + last sign-in. Applied live 2026-09-12.
-- crm_funnel joins auth.users, so it is granted to service_role only; the
-- console's Person page reads this one row through a definer function instead.
create or replace function public.person_stage(uid uuid)
returns table (stage int, stage_entered_at timestamptz, last_sign_in_at timestamptz)
language sql security definer set search_path = public as $$
  select f.stage, f.stage_entered_at, f.last_sign_in_at
  from public.crm_funnel f
  where f.id = uid and public.is_owner();
$$;
revoke all on function public.person_stage(uuid) from public;
grant execute on function public.person_stage(uuid) to authenticated;
