-- Platform KPIs for the Overview page, 2026-08-26
-- One owner-gated RPC computes everything server-side (auth.users sign-ins,
-- funnel stages, week-over-week windows) so the console renders a strip of
-- tiles with deltas. Facilitators get null → no strip.

create or replace function platform_kpis()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when is_owner() then jsonb_build_object
  (
    -- growth
    'users_total',      (select count(*) from profiles),
    'users_new_wk',     (select count(*) from profiles where created_at > now() - interval '7 days'),
    'users_new_prev',   (select count(*) from profiles where created_at > now() - interval '14 days'
                                                         and created_at <= now() - interval '7 days'),
    'signed_in_total',  (select count(*) from auth.users where last_sign_in_at is not null),
    'wau',              (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),

    -- maturity (from the derived funnel)
    'activated',        (select count(*) from crm_funnel where stage >= 2),
    'fully_activated',  (select count(*) from crm_funnel where stage = 4),

    -- engagement, week over week
    'rsvps_wk',         (select count(*) from rsvps where created_at > now() - interval '7 days'),
    'rsvps_prev',       (select count(*) from rsvps where created_at > now() - interval '14 days'
                                                     and created_at <= now() - interval '7 days'),
    'yaps_wk',          (select count(*) from yaps where created_at > now() - interval '7 days'),
    'yaps_prev',        (select count(*) from yaps where created_at > now() - interval '14 days'
                                                    and created_at <= now() - interval '7 days'),
    'circles_wk',       (select count(*) from connections where created_at > now() - interval '7 days'),
    'circles_prev',     (select count(*) from connections where created_at > now() - interval '14 days'
                                                           and created_at <= now() - interval '7 days'),
    'events_upcoming',  (select count(*) from activities
                         where date >= current_date
                            or (date is null and (expires_at is null or expires_at > now()))),

    -- acquisition + drips
    'invites_sent',     (select count(*) from invites),
    'invites_accepted', (select count(*) from invites where accepted_at is not null),
    'touches_wk',       (select count(*) from crm_touches where sent_at > now() - interval '7 days'),

    -- revenue (display ledger + membership run-rate, like the top bar)
    'mrr_cents',
      (select coalesce(sum(c.membership_price_cents * mm.cnt), 0)
         from communities c
         join lateral (select count(*) cnt from community_members m
                       where m.community_id = c.id and m.status = 'member') mm on true
        where c.archived_at is null)
      + (select coalesce(sum(amount_cents), 0) from ledger
          where happened_on >= date_trunc('month', now())::date)
  ) else null end;
$$;
grant execute on function platform_kpis() to authenticated;
