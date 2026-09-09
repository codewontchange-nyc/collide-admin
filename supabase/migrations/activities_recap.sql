-- Cached, once-generated recap of a wrapped plan (chat + details distilled to a
-- short nuanced line). Null = nothing worth saying yet / not enough material.
alter table public.activities add column if not exists recap text;
alter table public.activities add column if not exists recap_at timestamptz;
