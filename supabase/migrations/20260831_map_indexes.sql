-- Map/feed loading indexes. Applied live 2026-08-31. At beta scale every
-- scan is instant; these prevent the seq-scan cliffs at launch scale.
create index if not exists activities_city_idx        on activities (city, created_at desc);
create index if not exists activities_community_idx   on activities (community_id);
create index if not exists pois_city_idx              on pois (city);
create index if not exists map_events_city_idx        on map_events (city);
create index if not exists yaps_city_idx              on yaps (city, created_at desc);
create index if not exists communities_city_idx       on communities (city);
create index if not exists announcements_city_idx     on announcements (city, created_at desc);
create index if not exists announcements_comm_idx     on announcements (community_id);
create index if not exists event_messages_act_idx     on event_messages (activity_id, created_at);
create index if not exists community_messages_comm_idx on community_messages (community_id, created_at);
create index if not exists rsvps_profile_idx          on rsvps (profile_id);
create index if not exists connections_b_idx          on connections (b, a);
