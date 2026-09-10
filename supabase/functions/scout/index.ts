// scout — find events out there, bring them in here.
//
// POST { mode, ... }   (staff JWT; `refresh` also accepts x-push-secret for cron)
//   extract { url, city, ai?, force? }   → one public page → normalized item(s) in the feed
//   probe   { url }                      → what kind of watch source this URL would be
//   search  { city, from, to, q?, status? } → the feed (no network — sources fill it)
//   refresh { source_id?, limit? }       → pull due watch sources; expire stale items
//   ingest  { item_id, ... , dry? }      → owners only: publish a pick (see S2)
//
// Deployed with: supabase functions deploy scout --no-verify-jwt --project-ref pjxvvwcnjjizdtiutpxd

import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight, caller as getCaller, isAnyStaff, isOwner, fail, type Caller } from "../_shared/http.ts";
import { type CityRow, canonicalUrl, todayIn, whenBucket, dateExpiry, niceTime, guessCategory, EMOJI, trim, norm } from "./lib/item.ts";
import { copyImage } from "./lib/image.ts";
import { fetchText } from "./lib/fetch.ts";
import { upsertItems, cachedRun, runStart, runEnd } from "./lib/store.ts";
import { itemsFromJsonLd, ogFallback, claudeExtract, jsonLdEvents, jsonLdBlocks } from "./adapters/generic.ts";
import { parseIcs, looksLikeIcs } from "./adapters/ics.ts";
import { parseRss } from "./adapters/rss.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CACHE_MIN = 20;

async function cityRow(code: string): Promise<CityRow | null> {
  const { data } = await admin.from("cities").select("code,name,lat,lng,radius_km,tz").eq("code", code).maybeSingle();
  return (data as CityRow) || null;
}
async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const key = Deno.env.get("GOOGLE_MAPS_KEY_GEO") || Deno.env.get("GOOGLE_MAPS_KEY"); if (!key) return null;
  try {
    const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address.slice(0, 200))}&key=${key}`, { signal: AbortSignal.timeout(6000) }).then((x) => x.json());
    const g = r.results?.[0]?.geometry?.location; return g ? { lat: g.lat, lng: g.lng } : null;
  } catch { return null; }
}

/* ---------- extract: one URL → item(s) ---------- */
async function extract(url: string, city: CityRow, { ai = false, force = false, by = null as string | null, sourceId = null as string | null, allowAi = true } = {}) {
  const canon = canonicalUrl(url);
  const key = `extract|${canon}`;
  if (!force && !ai) {
    const c = await cachedRun(admin, key, CACHE_MIN);
    if (c) {
      const { data } = await admin.from("scout_items").select("*").eq("city", city.code).or(`external_id.eq.${canon.replace(/,/g, "%2C")},url.eq.${canon.replace(/,/g, "%2C")}`).order("start_date").limit(50);
      if (data?.length) return { items: data, method: "cached", cached: true };
    }
  }
  const run = await runStart(admin, key, "extract", sourceId, by);
  try {
    const page = await fetchText(url);
    if (!page.ok) throw new Error(`fetch_${page.status}`);
    let items = [] as ReturnType<typeof itemsFromJsonLd>; let method = "jsonld";
    if (looksLikeIcs(page.text, page.contentType)) { items = parseIcs(page.text, city, canon).map((i) => ({ ...i, source: "ics" as const })); method = "ics"; }
    else {
      items = itemsFromJsonLd(page.text, page.finalUrl || url, city);
      if (items.length === 1 && jsonLdEvents(jsonLdBlocks(page.text)).length === 1) items[0].external_id = canon, items[0].url = canon;
      if (!items.length || ai) {
        const og = ogFallback(page.text, page.finalUrl || url, city);
        const today = todayIn(city.tz);
        let partial = og as typeof og & { not_event?: boolean }; method = "og";
        if ((!og.start_date || ai) && allowAi) {
          const cl = await claudeExtract(page.text, url, city, today);
          if (cl && !cl.not_event) { partial = { ...og, ...cl, image_url: og.image_url ?? null }; method = og.start_date ? "claude+og" : "claude"; }
          else if (cl?.not_event) { await runEnd(admin, run, { found: 0, error: "not_event" }); return { items: [], method: "claude", error: "not_event" }; }
        }
        if (partial.title && partial.start_date) {
          items = [{ source: "generic", external_id: canon, url: canon, title: partial.title, description: partial.description ?? null,
            start_date: partial.start_date, start_time: partial.start_time ?? null, starts_at: partial.starts_at ?? null, ends_at: null,
            venue_name: partial.venue_name ?? null, address: partial.address ?? null, lat: null, lng: null,
            image_url: partial.image_url ?? null, price_min_cents: partial.price_min_cents ?? null, price_max_cents: partial.price_max_cents ?? null, currency: "USD",
            organizer_name: partial.organizer_name ?? null, organizer_url: null, categories: partial.categories ?? [], raw: { method } }];
        } else if (!items.length) { await runEnd(admin, run, { found: 0, error: "no_date" }); return { items: [], method, error: "no_date", partial: { title: partial.title, image_url: partial.image_url } }; }
      }
    }
    // one geocode per item that has an address but no coordinates
    for (const i of items) if (i.address && (i.lat == null || i.lng == null)) { const g = await geocode(i.address + (i.address.match(/\b(NY|GA|New York|Atlanta)\b/i) ? "" : `, ${city.name}`)); if (g) { i.lat = g.lat; i.lng = g.lng; } }
    const rows = await upsertItems(admin, city.code, items, sourceId);
    await runEnd(admin, run, { found: items.length, upserted: rows.length });
    return { items: rows, method, cached: false };
  } catch (e) {
    await runEnd(admin, run, { error: String((e as Error)?.message || e) });
    throw e;
  }
}

/* ---------- probe: what would this URL be on the watch list? ---------- */
async function probe(url: string) {
  const page = await fetchText(url, { maxBytes: 8_000_000 });
  if (!page.ok) return { kind: "unknown", error: `fetch_${page.status}` };
  if (looksLikeIcs(page.text, page.contentType)) return { kind: "ics", url };
  if (/^\s*<\?xml[\s\S]{0,300}?<(rss|feed)\b/i.test(page.text) || /<(rss|feed)\b/i.test(page.text.slice(0, 2000)) || /application\/(rss|atom)\+xml/i.test(page.contentType)) return { kind: "rss", url };
  // Luma calendar page → its subscribe feed
  const luma = page.text.match(/https?:\/\/api\.lu\.ma\/ics\/get\?entity=calendar&(?:amp;)?id=[a-zA-Z0-9-]+/);
  if (luma) return { kind: "ics", url: luma[0].replace(/&amp;/g, "&"), label: (page.text.match(/<title[^>]*>([^<]{1,80})/i)?.[1] || "").trim() };
  const alt = page.text.match(/<link[^>]+type=["']text\/calendar["'][^>]+href=["']([^"']+)["']/i) || page.text.match(/<link[^>]+href=["']([^"']+\.ics[^"']*)["']/i);
  if (alt) { try { return { kind: "ics", url: new URL(alt[1].replace(/^webcal:/, "https:"), url).toString() }; } catch { /* fallthrough */ } }
  const rss = page.text.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]+href=["']([^"']+)["']/i);
  const n = jsonLdEvents(jsonLdBlocks(page.text)).length;
  if (n >= 2) return { kind: "jsonld_page", url, events: n };
  if (rss) { try { return { kind: "rss", url: new URL(rss[1], url).toString() }; } catch { /* fallthrough */ } }
  return { kind: n === 1 ? "single_event" : "unknown", url, events: n };
}

/* ---------- refresh: pull due sources ---------- */
async function refresh({ sourceId = null as string | null, limit = 10, by = null as string | null } = {}) {
  const deadline = Date.now() + 25_000;
  let q = admin.from("scout_sources").select("*").eq("enabled", true).order("last_run_at", { ascending: true, nullsFirst: true }).limit(limit);
  if (sourceId) q = admin.from("scout_sources").select("*").eq("id", sourceId);
  const { data: sources } = await q;
  const results: unknown[] = [];
  for (const s of sources || []) {
    if (Date.now() > deadline) break;
    if (!sourceId && s.last_run_at && Date.parse(s.last_run_at) > Date.now() - s.interval_minutes * 60e3) continue;
    const city = await cityRow(s.city); if (!city) continue;
    const run = await runStart(admin, `refresh|${s.id}`, "refresh", s.id, by);
    const stamp = { last_run_at: new Date().toISOString() } as Record<string, unknown>;
    try {
      let count = 0;
      if (s.kind === "ics") {
        const page = await fetchText(s.url, { maxBytes: 8_000_000 }); if (!page.ok) throw new Error(`fetch_${page.status}`);
        const items = parseIcs(page.text, city, s.url);
        count = (await upsertItems(admin, city.code, items, s.id)).length;
      } else if (s.kind === "jsonld_page") {
        const r = await extract(s.url, city, { force: true, by, sourceId: s.id, allowAi: false });
        count = r.items.length;
      } else if (s.kind === "rss") {
        const page = await fetchText(s.url, { maxBytes: 8_000_000 }); if (!page.ok) throw new Error(`fetch_${page.status}`);
        // entries that carry the event themselves land directly; the rest are read the cheap way
        const entries = parseRss(page.text, city, s.url);
        const direct = entries.filter((e) => e.item).map((e) => e.item!);
        if (direct.length) count += (await upsertItems(admin, city.code, direct, s.id)).length;
        const links = entries.filter((e) => !e.item).map((e) => e.link).filter((u) => u !== s.url);
        for (const u of [...new Set(links)].slice(0, 20)) {
          if (Date.now() > deadline) break;
          try { const r = await extract(u, city, { by, sourceId: s.id, allowAi: false }); count += r.items.length; } catch { /* one bad link doesn't sink the feed */ }
        }
      }
      Object.assign(stamp, { last_ok_at: new Date().toISOString(), last_error: null, last_count: count });
      await runEnd(admin, run, { found: count, upserted: count });
      results.push({ source: s.id, label: s.label, count });
    } catch (e) {
      const msg = String((e as Error)?.message || e).slice(0, 300);
      Object.assign(stamp, { last_error: msg });
      await runEnd(admin, run, { error: msg });
      results.push({ source: s.id, label: s.label, error: msg });
    }
    await admin.from("scout_sources").update(stamp).eq("id", s.id);
  }
  // housekeeping: yesterday's items expire; dismissed/expired ones are purged after 30 days
  const { data: cities } = await admin.from("cities").select("code,tz");
  for (const c of cities || []) {
    const y = new Date(Date.parse(todayIn(c.tz) + "T00:00:00Z") - 864e5).toISOString().slice(0, 10);
    await admin.from("scout_items").update({ status: "expired" }).eq("city", c.code).in("status", ["new", "saved"]).lt("start_date", y);
  }
  await admin.from("scout_items").delete().in("status", ["expired", "dismissed"]).lt("updated_at", new Date(Date.now() - 30 * 864e5).toISOString());
  return { ran: results.length, results };
}

/* ---------- ingest: a feed item becomes a public "Collide pick" ----------
   Owners only. Hosted by the house profile (service role writes; the caller
   was already verified), so act_ins stays untouched. A city-wide pick is only
   visible to members once it has a map pin, so without x/y we refuse rather
   than publish something invisible. `dry` returns the proposed row + placement. */
const SOURCE_NAME: Record<string, string> = { ics: "calendar", rss: "feed", jsonld_page: "listing", generic: "" };
async function ingest(b: Record<string, unknown>, me: Caller) {
  const house = Deno.env.get("SCOUT_HOST_PROFILE_ID");
  if (!house) return { error: "SCOUT_HOST_PROFILE_ID is not set" };
  const { data: item } = await admin.from("scout_items").select("*").eq("id", String(b.item_id || "")).maybeSingle();
  if (!item) return { error: "Item not found" };
  if (item.status === "ingested" && item.activity_id) {
    const { data: a } = await admin.from("activities").select("id").eq("id", item.activity_id).maybeSingle();
    if (a) return { error: "Already in Collide", activity_id: item.activity_id };
  }
  const city = await cityRow(item.city); if (!city) return { error: "Unknown city" };
  const today = todayIn(city.tz);
  const date = String(b.date || item.start_date), starts_at = (b.starts_at ?? item.start_time) ? String(b.starts_at ?? item.start_time).slice(0, 5) : null;
  const title = trim(String(b.title || item.title), 120);
  const location = item.venue_name || (item.address ? String(item.address).split(",")[0] : null);
  const category = String(b.category || guessCategory(item.categories || [], item.title));
  const via = ["via", SOURCE_NAME[item.source] ? SOURCE_NAME[item.source] + " ·" : "", (() => { try { return new URL(item.url).hostname.replace(/^www\./, ""); } catch { return ""; } })(), item.organizer_name ? "· " + item.organizer_name : ""].filter(Boolean).join(" ");
  const priceNote = item.price_min_cents != null && item.price_max_cents != null && item.price_max_cents !== item.price_min_cents ? `from $${(item.price_min_cents / 100).toFixed(0)}–$${(item.price_max_cents / 100).toFixed(0)}` : "";
  const note = [via, priceNote, b.note != null ? trim(String(b.note), 280) : trim(item.description, 280)].filter(Boolean).join(" — ");
  const community_id = b.community_id ? String(b.community_id) : null;
  const row = {
    host_id: house, community_id, title, date, starts_at, location,
    lat: item.lat, lng: item.lng, image_path: null as string | null,
    price_cents: item.price_min_cents ?? 0, category, note, capacity: null, link: item.url,
    visibility: "public", city: item.city,
    place: location, at_time: niceTime(starts_at), when_bucket: whenBucket(date, today), expires_at: dateExpiry(date, city.tz),
  };
  // placement: admin's click → a POI with the venue's name → nothing (refuse)
  let place: { x: number; y: number; origin: string } | null = null;
  if (typeof b.x === "number" && typeof b.y === "number") place = { x: Math.min(1, Math.max(0, b.x)), y: Math.min(1, Math.max(0, b.y)), origin: "placed" };
  else if (item.venue_name) {
    const words = norm(item.venue_name).slice(0, 3).join(" ");
    const { data: exact } = await admin.from("pois").select("name,x,y").eq("city", item.city).ilike("name", item.venue_name).not("x", "is", null).limit(1);
    const { data: loose } = exact?.length || !words ? { data: [] } : await admin.from("pois").select("name,x,y").eq("city", item.city).ilike("name", words + "%").not("x", "is", null).limit(1);
    const p = exact?.[0] || loose?.[0];
    if (p) place = { x: p.x, y: p.y, origin: "poi: " + p.name };
  }
  // soft warning: a hand-made event that looks like the same thing
  const words = norm(item.title).slice(0, 3).join(" ");
  const { data: similar } = words ? await admin.from("activities").select("id,title").eq("city", item.city).eq("date", date).ilike("title", `%${words}%`).limit(3) : { data: [] };
  if (b.dry) {
    const { data: src } = item.source_id ? await admin.from("scout_sources").select("label,default_category,default_community_id").eq("id", item.source_id).maybeSingle() : { data: null };
    return { row, place, warnings: (similar || []).map((a) => ({ activity_id: a.id, title: a.title })), item, defaults: src ? { label: src.label, category: src.default_category, community_id: src.default_community_id } : null };
  }

  if (!community_id && !place) return { error: "unplaced", place: null };
  if (b.use_image !== false && item.image_url) row.image_path = await copyImage(admin, item.image_url, item.id);
  const { data: act, error: aErr } = await admin.from("activities").insert(row).select("id").single();
  if (aErr) return { error: aErr.message };
  let pin_id: string | null = null;
  if (!community_id && place) {
    const { data: pin, error: pErr } = await admin.from("map_events").insert({
      activity_id: act.id, from_activity: true, title, emoji: EMOJI[category] || "✨", at_time: row.at_time, place: location, venue: "",
      note: trim(item.description, 140) || null, link: item.url, x: place.x, y: place.y, city: item.city, expires_at: row.expires_at, created_by: house,
    }).select("id").single();
    if (pErr) { await admin.from("activities").delete().eq("id", act.id); return { error: "Pin failed: " + pErr.message }; }
    pin_id = pin.id;
  }
  await admin.from("scout_items").update({ status: "ingested", activity_id: act.id, ingested_by: me.user.id, ingested_at: new Date().toISOString() }).eq("id", item.id);
  await admin.from("scout_items").update({ status: "dismissed", dupe_of: item.id }).eq("dupe_of", item.id).in("status", ["new", "saved"]);
  if (item.dupe_of) await admin.from("scout_items").update({ status: "dismissed" }).eq("id", item.dupe_of).in("status", ["new", "saved"]);
  return { activity_id: act.id, pin_id, image_path: row.image_path, place };
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    const mode = String(b.mode || "");
    // cron path: shared secret, refresh only
    if (mode === "refresh" && req.headers.get("x-push-secret") && req.headers.get("x-push-secret") === Deno.env.get("PUSH_WEBHOOK_SECRET")) {
      return json(await refresh({ limit: Number(b.limit) || 10 }));
    }
    const me: Caller | null = await getCaller(req);
    if (!me?.user) return json({ error: "Not signed in" }, 401);
    if (!(await isAnyStaff(me))) return json({ error: "Staff only" }, 403);

    if (mode === "extract") {
      const url = String(b.url || "").trim();
      if (!/^https?:\/\/\S+$/i.test(url)) return json({ error: "Paste a full link (https://…)" }, 400);
      const city = await cityRow(String(b.city || "nyc")); if (!city) return json({ error: "Unknown city" }, 400);
      try { return json(await extract(url, city, { ai: !!b.ai, force: !!b.force, by: me.user.id })); }
      catch (e) { const m = String((e as Error)?.message || e); return json({ error: m.startsWith("fetch_") ? `That page answered ${m.slice(6)}` : m === "too_large" ? "That page is too big to read" : /timeout|abort/i.test(m) ? "That page took too long to answer" : m }, 422); }
    }
    if (mode === "probe") {
      const url = String(b.url || "").trim();
      if (!/^https?:\/\/\S+$/i.test(url)) return json({ error: "Paste a full link (https://…)" }, 400);
      try { return json(await probe(url)); } catch (e) { return json({ kind: "unknown", error: String((e as Error)?.message || e) }); }
    }
    if (mode === "search") {
      const city = String(b.city || "nyc"), from = String(b.from || todayIn("America/New_York")), to = String(b.to || "2099-12-31");
      let q = me.client.from("scout_items").select("*").eq("city", city).gte("start_date", from).lte("start_date", to).order("start_date").order("start_time", { nullsFirst: false }).limit(500);
      const status = String(b.status || "");
      if (status === "new") q = q.in("status", ["new", "saved"]); else if (status && status !== "all") q = q.eq("status", status);
      const kw = String(b.q || "").trim().slice(0, 80);
      if (kw) q = q.or(`title.ilike.%${kw}%,venue_name.ilike.%${kw}%,organizer_name.ilike.%${kw}%,description.ilike.%${kw}%`);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 400);
      return json({ items: data || [] });
    }
    if (mode === "refresh") {
      return json(await refresh({ sourceId: b.source_id ? String(b.source_id) : null, limit: Number(b.limit) || 10, by: me.user.id }));
    }
    if (mode === "ingest") {
      if (!(await isOwner(me))) return json({ error: "Owners only" }, 403);
      const r = await ingest(b, me) as { error?: string };
      return json(r, r.error ? (r.error === "unplaced" ? 409 : 400) : 200);
    }
    return json({ error: "mode" }, 400);
  } catch (e) { return fail(e); }
});
