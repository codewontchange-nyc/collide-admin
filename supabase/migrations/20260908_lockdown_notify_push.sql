-- lockdown notify push. Applied live 2026-09-08 (recorded post-hoc; see README).
-- Bug sweep 2026-09-08, CRITICAL: notify_push() was executable by anon
-- (default PUBLIC grant on functions) — anyone with the public anon key
-- could send arbitrary push notifications (title/body/link fully attacker-
-- controlled) to any member. All trigger callers are SECURITY DEFINER owned
-- by postgres, so they are unaffected by the revoke.
revoke execute on function notify_push(uuid[], text, text, text) from public, anon, authenticated;
grant execute on function notify_push(uuid[], text, text, text) to service_role;

-- hygiene: join_event's earlier "revoke from anon" was inert against the
-- default PUBLIC grant (it is internally auth-gated regardless)
revoke execute on function join_event(uuid, boolean, text) from public;
grant execute on function join_event(uuid, boolean, text) to authenticated;
