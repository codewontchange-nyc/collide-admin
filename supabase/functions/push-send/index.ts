// push-send — web-push fan-out. Subscriptions live in push_subs.
//
// POST { title, body, url?, profile_ids?, community_id? }
//   profile_ids set   → push to exactly those users (targeted; notify_push)
//   community_id set   → push to that community's members (push_on_announcement)
//   neither set        → broadcast to every subscription (staff-initiated)
//
// Callers: the announcements DB trigger and notify_push (each with its own
// x-push-secret), or signed-in staff (Authorization JWT). Dead subscriptions
// (404/410) are pruned. Both DB secrets are accepted so the one deployed
// function serves both the broadcast and targeted contracts.
//
// Deployed with: supabase functions deploy push-send --no-verify-jwt --project-ref pjxvvwcnjjizdtiutpxd
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_WEBHOOK_SECRET, PUSH_SECRET

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(
  "mailto:icandothatforyou@gmail.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

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
    // auth: either DB webhook secret (announcement broadcast OR notify_push
    // targeted) or a staff JWT (console)
    const hdrSecret = req.headers.get("x-push-secret");
    const secretOk = !!hdrSecret &&
      (hdrSecret === Deno.env.get("PUSH_WEBHOOK_SECRET") || hdrSecret === Deno.env.get("PUSH_SECRET"));
    if (!secretOk) {
      const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: { user } } = await admin.auth.getUser(jwt);
      if (!user?.email) return json({ error: "Not allowed" }, 401);
      const { data: staff } = await admin.from("staff").select("email");
      if (!(staff || []).some((s) => s.email?.toLowerCase() === user.email!.toLowerCase()))
        return json({ error: "Staff only" }, 403);
    }

    const { title, body, url, community_id = null, profile_ids = null } = await req.json();
    if (!title || !body) return json({ error: "title and body required" }, 400);

    let subs: { endpoint: string; p256dh: string; auth: string }[] = [];
    if (Array.isArray(profile_ids)) {
      // targeted (notify_push): exactly these users, never a broadcast fallback
      const ids = profile_ids.filter(Boolean);
      if (ids.length) {
        const { data } = await admin.from("push_subs").select("*").in("profile_id", ids);
        subs = data || [];
      }
    } else if (community_id) {
      const { data: members } = await admin.from("community_members")
        .select("profile_id").eq("community_id", community_id).neq("status", "pending");
      const ids = (members || []).map((m) => m.profile_id);
      if (ids.length) {
        const { data } = await admin.from("push_subs").select("*").in("profile_id", ids);
        subs = data || [];
      }
    } else {
      const { data } = await admin.from("push_subs").select("*");
      subs = data || [];
    }

    const payload = JSON.stringify({ title, body, url: url || "https://codewontchange-nyc.github.io/Collide/" });
    let sent = 0, pruned = 0, failed = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) { await admin.from("push_subs").delete().eq("endpoint", s.endpoint); pruned++; }
        else failed++;
      }
    }));
    return json({ ok: true, audience: subs.length, sent, pruned, failed });
  } catch (e) {
    console.error("push-send error:", e);
    return json({ error: "internal" }, 500);
  }
});
