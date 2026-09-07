// share — the event invite link. One URL that does two jobs:
//   crawlers  → per-event OG/Twitter meta (real unfurls on social)
//   humans    → instant redirect to the public landing page on collide-site
//
// GET /functions/v1/share?e=<event uuid>&ref=<sharer connect_code>&utm_*=...
//
// Deployed with: supabase functions deploy share --no-verify-jwt --project-ref pjxvvwcnjjizdtiutpxd

import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SITE = "https://codewontchange-nyc.github.io/collide-site";
const MEDIA = Deno.env.get("SUPABASE_URL")! + "/storage/v1/object/public/event-media/";
const FALLBACK_OG = `${SITE}/map.jpg`;

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const e = url.searchParams.get("e") || "";
  if (!/^[0-9a-f-]{36}$/.test(e)) return new Response("bad link", { status: 400 });

  const { data: p } = await admin.rpc("event_invite_preview", { eid: e });
  if (!p) return new Response("This plan has wrapped — find the next one on Collide.", { status: 404 });

  const ev = p.event, going = p.going, comm = p.community;
  const title = ev.title || "A Collide plan";
  const bits = [
    going.count > 0 ? `${going.count} going` : null,
    ev.date ? new Date(ev.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : null,
    ev.at_time, comm ? `hosted by ${comm.name}` : null,
  ].filter(Boolean).join(" · ");
  const desc = `${bits ? bits + " — " : ""}join the plan on Collide.`;
  const img = ev.image_path ? MEDIA + ev.image_path : FALLBACK_OG;

  // pass everything through to the landing (ref, utm_*)
  const pass = new URLSearchParams(url.searchParams);
  const landing = `${SITE}/e/?${pass.toString()}`;

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(title)} — Collide</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="Collide">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:url" content="${esc(landing)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(img)}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<script>location.replace(${JSON.stringify(landing)});</script>
</head><body style="font-family:Georgia,serif;background:#fbf6f0;color:#241d1a;text-align:center;padding:60px 20px">
<p>${esc(title)}</p><p><a href="${esc(landing)}">Continue to the invite →</a></p>
</body></html>`;
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  }});
});
