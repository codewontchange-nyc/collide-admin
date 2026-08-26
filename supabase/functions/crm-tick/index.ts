// crm-tick — the drip engine. Runs hourly via pg_cron (x-push-secret) and
// on demand from the console (staff JWT). POST {} or { dry: true }.
//
// Each run: derive everyone's funnel stage (crm_funnel view), find the
// earliest unsent due campaign step for their stage, apply guardrails
// (staff excluded, opt-out honored, ≥48h between touches, 10:00–20:00 in
// the user's city), personalize, then deliver: push → real web-push to
// their subscriptions; email → DRY RUN (logged, not sent) until custom
// SMTP lands. Every touch is recorded in crm_touches.
//
// Deployed with: supabase functions deploy crm-tick --no-verify-jwt --project-ref pjxvvwcnjjizdtiutpxd

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(
  "mailto:icandothatforyou@gmail.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const APP_URL = "https://codewontchange-nyc.github.io/Collide/";
const MIN_GAP_H = 48;
const SEND_START = 10, SEND_END = 20;   // local hours
const MAX_PER_RUN = 50;

const TZ: Record<string, string> = {
  nyc: "America/New_York", atl: "America/New_York", dc: "America/New_York",
  chi: "America/Chicago", nola: "America/Chicago",
  la: "America/Los_Angeles", sf: "America/Los_Angeles",
};
const CITY_LABEL: Record<string, string> = {
  nyc: "New York", atl: "Atlanta", la: "Los Angeles", chi: "Chicago",
  sf: "San Francisco", nola: "New Orleans", dc: "Washington DC",
};
const localHour = (city: string) =>
  parseInt(new Intl.DateTimeFormat("en-US", { timeZone: TZ[city] || TZ.nyc, hour: "numeric", hour12: false })
    .format(new Date()), 10) % 24;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-push-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    // ---- auth: cron secret or staff JWT ----
    const secretOk = req.headers.get("x-push-secret") === Deno.env.get("PUSH_WEBHOOK_SECRET");
    if (!secretOk) {
      const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: { user } } = await admin.auth.getUser(jwt);
      if (!user?.email) return json({ error: "Not allowed" }, 401);
      const { data: staff } = await admin.from("staff").select("email");
      if (!(staff || []).some((s) => s.email?.toLowerCase() === user.email!.toLowerCase()))
        return json({ error: "Staff only" }, 403);
    }
    const { dry = false } = await req.json().catch(() => ({}));

    // ---- load the world once ----
    const [funnel, staff, campaigns, touches, subs, memberships, comms, events] = await Promise.all([
      admin.from("crm_funnel").select("*"),
      admin.from("staff").select("email"),
      admin.from("crm_campaigns").select("*").eq("enabled", true).order("stage").order("step"),
      admin.from("crm_touches").select("profile_id, campaign_id, sent_at"),
      admin.from("push_subscriptions").select("*"),
      admin.from("community_members").select("profile_id, community_id, joined_at").neq("status", "pending"),
      admin.from("communities").select("id, name, archived_at"),
      admin.from("activities").select("title, date, city").gte("date", new Date().toISOString().slice(0, 10))
        .order("date").limit(200),
    ]);
    const staffEmails = new Set((staff.data || []).map((s) => s.email?.toLowerCase()));
    const { data: authUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const emailById = new Map((authUsers?.users || []).map((u) => [u.id, u.email?.toLowerCase() || ""]));

    const subsBy = new Map<string, any[]>();
    for (const s of subs.data || []) {
      if (!subsBy.has(s.profile_id)) subsBy.set(s.profile_id, []);
      subsBy.get(s.profile_id)!.push(s);
    }
    const commName = new Map((comms.data || []).map((c) => [c.id, c]));
    const firstCommunity = new Map<string, string>();
    for (const m of (memberships.data || []).sort((a, b) => (a.joined_at || "").localeCompare(b.joined_at || ""))) {
      const c = commName.get(m.community_id);
      if (c && !c.archived_at && !firstCommunity.has(m.profile_id)) firstCommunity.set(m.profile_id, c.name);
    }
    const nextEvent = new Map<string, string>();
    for (const e of events.data || []) {
      const city = e.city || "nyc";
      if (!nextEvent.has(city) && e.title) nextEvent.set(city, e.title);
    }
    const touched = new Set((touches.data || []).map((t) => `${t.profile_id}:${t.campaign_id}`));
    const lastTouch = new Map<string, number>();
    for (const t of touches.data || []) {
      const at = new Date(t.sent_at).getTime();
      if (at > (lastTouch.get(t.profile_id) || 0)) lastTouch.set(t.profile_id, at);
    }

    // ---- pick due touches ----
    const now = Date.now();
    const planned: any[] = [];
    const skipped: Record<string, number> = {};
    const skip = (k: string) => { skipped[k] = (skipped[k] || 0) + 1; };

    for (const u of funnel.data || []) {
      if (u.stage >= 4) continue;                                     // graduated 🎓
      if (u.crm_opt_out) { skip("opt_out"); continue; }
      if (staffEmails.has(emailById.get(u.id) || "")) { skip("staff"); continue; }
      const daysIn = Math.floor((now - new Date(u.stage_entered_at).getTime()) / 864e5);
      const due = (campaigns.data || []).filter((c) =>
        c.stage === u.stage && c.day_offset <= daysIn && !touched.has(`${u.id}:${c.id}`));
      if (!due.length) { skip("nothing_due"); continue; }
      const last = lastTouch.get(u.id) || 0;
      if (now - last < MIN_GAP_H * 36e5) { skip("too_soon"); continue; }
      const hr = localHour(u.city);
      if (hr < SEND_START || hr >= SEND_END) { skip("quiet_hours"); continue; }
      const c = due[0];   // earliest unsent step
      const fill = (s: string) => s
        .replaceAll("{{name}}", u.display_name || "there")
        .replaceAll("{{city}}", CITY_LABEL[u.city] || u.city)
        .replaceAll("{{community}}", firstCommunity.get(u.id) || "your community")
        .replaceAll("{{event}}", nextEvent.get(u.city) || "something on the map");
      planned.push({ u, c, title: fill(c.title), body: fill(c.body) });
      if (planned.length >= MAX_PER_RUN) break;
    }

    if (dry) {
      return json({ ok: true, dry: true, planned: planned.map((p) => ({
        profile: p.u.display_name, stage: p.u.stage, step: p.c.step, channel: p.c.channel,
        title: p.title, body: p.body })), skipped });
    }

    // ---- deliver + log ----
    let pushed = 0, dryEmails = 0;
    for (const p of planned) {
      const results: string[] = [];
      const wantPush = p.c.channel === "push" || p.c.channel === "both";
      const wantEmail = p.c.channel === "email" || p.c.channel === "both";
      if (wantPush) {
        const targets = subsBy.get(p.u.id) || [];
        let sent = 0;
        for (const s of targets) {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              JSON.stringify({ title: p.title, body: p.body, url: APP_URL }));
            sent++;
          } catch (e) {
            const code = (e as { statusCode?: number })?.statusCode;
            if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
          }
        }
        pushed += sent;
        results.push(targets.length ? `push:${sent}/${targets.length}` : "push:no-subscription");
      }
      if (wantEmail) { results.push("email:dry-run"); dryEmails++; }   // real sends once custom SMTP lands
      await admin.from("crm_touches").insert({
        profile_id: p.u.id, campaign_id: p.c.id, stage: p.c.stage, step: p.c.step,
        channel: p.c.channel, title: p.title, body: p.body, result: results.join(" · "),
      });
    }

    return json({ ok: true, touched: planned.length, pushed, dryEmails, skipped });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
