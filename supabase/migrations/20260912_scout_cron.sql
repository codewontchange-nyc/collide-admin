-- Scout: scheduled source refresh + starter sources. Applied live 2026-09-10.
-- The tick calls the `scout` function's cron path (x-push-secret = PUSH_WEBHOOK_SECRET),
-- which reads every enabled source whose interval has elapsed (10 per tick), expires
-- yesterday's items and purges dismissed/expired ones after 30 days.
-- `__PUSH_SECRET__` is a placeholder; the real value was substituted at apply time.

create extension if not exists pg_cron;
select cron.unschedule('scout-refresh') where exists (select 1 from cron.job where jobname = 'scout-refresh');
select cron.schedule('scout-refresh', '20 */3 * * *', $$
  select net.http_post(
    url := 'https://pjxvvwcnjjizdtiutpxd.supabase.co/functions/v1/scout',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', '__PUSH_SECRET__'),
    body := '{"mode":"refresh","limit":10}'::jsonb)
$$);

-- ============ starter sources (each probed OK on 2026-09-10) ============
insert into scout_sources (city, kind, label, url, interval_minutes, notes) values
  ('nyc', 'jsonld_page', 'Eventbrite · New York',      'https://www.eventbrite.com/d/ny--new-york/events/',        180, 'public listing page'),
  ('nyc', 'jsonld_page', 'Eventbrite · NYC free',      'https://www.eventbrite.com/d/ny--new-york/free--events/',  360, 'public listing page'),
  ('nyc', 'jsonld_page', 'Luma · NYC',                 'https://lu.ma/nyc',                                        180, 'city discover page'),
  ('nyc', 'rss',         'NYC Parks events',           'https://www.nycgovparks.org/xml/events_300_rss.xml',       360, 'free public programming'),
  ('atl', 'jsonld_page', 'Eventbrite · Atlanta',       'https://www.eventbrite.com/d/ga--atlanta/events/',         180, 'public listing page'),
  ('atl', 'jsonld_page', 'Eventbrite · Atlanta free',  'https://www.eventbrite.com/d/ga--atlanta/free--events/',   360, 'public listing page'),
  ('atl', 'jsonld_page', 'Luma · Atlanta',             'https://lu.ma/atlanta',                                    180, 'city discover page')
on conflict (city, url) do nothing;
