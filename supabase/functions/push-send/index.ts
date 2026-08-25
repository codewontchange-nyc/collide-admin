// push-send — web-push broadcast.
//
// POST { title, body, url?, community_id? }
//   community_id set  → push to that community's members' subscriptions
//   community_id null → push to every subscription (Collide-wide)
//
// Callers: the announcements DB trigger (x-push-secret header) or signed-in
// staff (Authorization JWT). Dead subscriptions (404/410) are pruned.
//
// Deployed with: supabase functions deploy push-send --no-verify-jwt --project-ref pjxvvwcnjjizdtiutpxd
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_WEBHOOK_SECRET

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
    // auth: webhook secret (DB trigger) or staff JWT (console)
    const secretOk = req.headers.get("x-push-secret") === Deno.env.get("PUSH_WEBHOOK_SECRET");
    if (!secretOk) {
      const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: { user } } = await admin.auth.getUser(jwt);
      if (!user?.email) return json({ error: "Not allowed" }, 401);
      const { data: staff } = await admin.from("staff").select("email");
      if (!(staff || []).some((s) => s.email?.toLowerCase() === user.email!.toLowerCase()))
        return json({ error: "Staff only" }, 403);
    }

    const { title, body, url, community_id = null } = await req.json();
    if (!title || !body) return json({ error: "title and body required" }, 400);

    let subs: { id: string; endpoint: string; p256dh: string; auth: string }[] = [];
    if (community_id) {
      const { data: members } = await admin.from("community_members")
        .select("profile_id").eq("community_id", community_id).neq("status", "pending");
      const ids = (members || []).map((m) => m.profile_id);
      if (ids.length) {
        const { data } = await admin.from("push_subscriptions").select("*").in("profile_id", ids);
        subs = data || [];
      }
    } else {
      const { data } = await admin.from("push_subscriptions").select("*");
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
        if (code === 404 || code === 410) { await admin.from("push_subscriptions").delete().eq("id", s.id); pruned++; }
        else failed++;
      }
    }));
    return json({ ok: true, audience: subs.length, sent, pruned, failed });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
