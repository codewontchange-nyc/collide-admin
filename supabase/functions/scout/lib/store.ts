// lib/store.ts — writing the feed: upsert by (source, external_id) touching
// content + fetched_at only (status / activity_id belong to the admin), then
// cross-source dupe marking by fingerprint. Runs double as a fetch cache.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type Item, fingerprint } from "./item.ts";

export type Row = Item & { id: string; city: string; fingerprint: string; status: string; dupe_of: string | null; activity_id: string | null; source_id: string | null };

export async function upsertItems(sb: SupabaseClient, city: string, items: Item[], sourceId: string | null): Promise<Row[]> {
  if (!items.length) return [];
  const now = new Date().toISOString();
  const rows = items.map((i) => ({
    city, source: i.source, external_id: i.external_id, source_id: sourceId, url: i.url,
    title: i.title, description: i.description ?? null,
    start_date: i.start_date, start_time: i.start_time ?? null, starts_at: i.starts_at ?? null, ends_at: i.ends_at ?? null,
    venue_name: i.venue_name ?? null, address: i.address ?? null, lat: i.lat ?? null, lng: i.lng ?? null,
    image_url: i.image_url ?? null, price_min_cents: i.price_min_cents ?? null, price_max_cents: i.price_max_cents ?? null, currency: i.currency || "USD",
    organizer_name: i.organizer_name ?? null, organizer_url: i.organizer_url ?? null,
    categories: i.categories || [], raw: i.raw ?? null,
    fingerprint: fingerprint(i.title, i.start_date, i.venue_name), fetched_at: now,
  }));
  const { data, error } = await sb.from("scout_items").upsert(rows, { onConflict: "source,external_id" }).select("*");
  if (error) throw new Error(error.message);
  const out = (data || []) as Row[];
  // cross-source dupes: the oldest item with the same fingerprint in this city is the original
  const fps = [...new Set(out.map((r) => r.fingerprint))];
  if (fps.length) {
    const { data: sib } = await sb.from("scout_items").select("id,fingerprint,first_seen_at").eq("city", city).in("fingerprint", fps).order("first_seen_at");
    const first = new Map<string, string>();
    for (const s of sib || []) if (!first.has(s.fingerprint)) first.set(s.fingerprint, s.id);
    for (const r of out) {
      const orig = first.get(r.fingerprint);
      if (orig && orig !== r.id && r.dupe_of !== orig) { await sb.from("scout_items").update({ dupe_of: orig }).eq("id", r.id); r.dupe_of = orig; }
    }
  }
  return out;
}

export async function cachedRun(sb: SupabaseClient, key: string, minutes: number) {
  const { data } = await sb.from("scout_runs").select("id,started_at,found").eq("key", key).is("error", null).gt("started_at", new Date(Date.now() - minutes * 60e3).toISOString()).order("started_at", { ascending: false }).limit(1).maybeSingle();
  return data || null;
}
export async function runStart(sb: SupabaseClient, key: string, kind: string, sourceId: string | null, by: string | null) {
  const { data } = await sb.from("scout_runs").insert({ key, kind, source_id: sourceId, by }).select("id").single();
  return data?.id as number;
}
export async function runEnd(sb: SupabaseClient, id: number, patch: { found?: number; upserted?: number; error?: string | null }) {
  await sb.from("scout_runs").update({ finished_at: new Date().toISOString(), ...patch }).eq("id", id);
}
