-- drop dead push subscriptions. Applied live 2026-09-09 (recorded post-hoc; see README).
-- push_subscriptions was a dead, always-empty parallel to push_subs. All
-- producers (mobile app, admin console) and consumers (push-send, crm-tick,
-- moderate) now use push_subs; nothing references push_subscriptions.
drop table if exists public.push_subscriptions;
