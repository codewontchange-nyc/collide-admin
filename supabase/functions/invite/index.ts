// invite — staff-only email invites with magic links.
//
// POST { email, kind: "member" | "facilitator", community_id? }
//
//  · caller must be signed-in staff (facilitator invites: owners only;
//    member invites: owners, or facilitators for their own communities)
//  · new address  → auth.admin.inviteUserByEmail sends the branded invite
//    email (the template branches on invite_kind for the special
//    facilitator vs member copy) and the handle_new_user trigger creates
//    their profile, which we attach to the community right away
//  · existing user → membership/staff row is added and they get a
//    magic-link sign-in email pointing at the right surface
//
// Deployed with: supabase functions deploy invite --project-ref pjxvvwcnjjizdtiutpxd

import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const ADMIN_URL = "https://codewontchange-nyc.github.io/collide-admin/";
const APP_URL = "https://codewontchange-nyc.github.io/Collide/";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    // ---- who's asking ----
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user: caller } } = await admin.auth.getUser(jwt);
    if (!caller?.email) return json({ error: "Not signed in" }, 401);
    const { data: staff } = await admin.from("staff").select("*");
    const mine = (staff || []).filter((s) => s.email?.toLowerCase() === caller.email!.toLowerCase());
    if (!mine.length) return json({ error: "Staff only" }, 403);
    const isOwner = mine.some((s) => s.role === "owner");

    // ---- what they're asking for ----
    const { email, kind, community_id = null } = await req.json();
    const em = String(email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return json({ error: "Enter a valid email" }, 400);
    if (kind !== "member" && kind !== "facilitator") return json({ error: "kind must be member or facilitator" }, 400);
    if (kind === "facilitator" && !isOwner) return json({ error: "Only owners can invite facilitators" }, 403);
    if (kind === "member") {
      if (!community_id) return json({ error: "Pick a community" }, 400);
      if (!isOwner && !mine.some((s) => s.community_id === community_id || s.community_id === null))
        return json({ error: "You can only invite members to your own communities" }, 403);
    }

    let communityName: string | null = null;
    if (community_id) {
      const { data: c } = await admin.from("communities").select("name").eq("id", community_id).maybeSingle();
      if (!c) return json({ error: "Community not found" }, 404);
      communityName = c.name;
    }

    const redirectTo = kind === "facilitator" ? ADMIN_URL : APP_URL;

    // facilitators are gated by an email-keyed staff row — works pre-signup
    if (kind === "facilitator") {
      const already = (staff || []).some((s) =>
        s.email?.toLowerCase() === em && (s.community_id ?? null) === (community_id ?? null));
      if (!already) {
        const { error } = await admin.from("staff").insert({ email: em, role: "facilitator", community_id });
        if (error) return json({ error: error.message }, 400);
      }
    }

    // ---- create + email, or fall back to a sign-in link for existing users ----
    const meta = { invite_kind: kind, community_id, community_name: communityName, invited_by: caller.email };
    let userId: string | null = null;
    let emailed = "invite";
    const { data: inv, error: invErr } = await admin.auth.admin.inviteUserByEmail(em, { data: meta, redirectTo });
    if (invErr) {
      // almost always "already registered" — find them via generateLink, email a magic link
      const { data: gl, error: glErr } = await admin.auth.admin.generateLink({
        type: "magiclink", email: em, options: { redirectTo },
      });
      if (glErr) return json({ error: invErr.message }, 400);
      userId = gl.user?.id ?? null;
      emailed = "magiclink";
      const anon = createClient(URL, Deno.env.get("SUPABASE_ANON_KEY")!);
      const { error: otpErr } = await anon.auth.signInWithOtp({ email: em, options: { emailRedirectTo: redirectTo } });
      if (otpErr) return json({ error: "Added, but the email failed: " + otpErr.message }, 400);
    } else {
      userId = inv.user?.id ?? null;
    }

    // funnel: record the invite (resends bump attempts + sent_at)
    let priorQ = admin.from("invites").select("id,attempts").eq("email", em).eq("kind", kind);
    priorQ = community_id === null ? priorQ.is("community_id", null) : priorQ.eq("community_id", community_id);
    const { data: prior } = await priorQ.maybeSingle();
    if (prior) {
      await admin.from("invites").update({
        sent_at: new Date().toISOString(), attempts: (prior.attempts || 1) + 1, invited_by: caller.email,
      }).eq("id", prior.id);
    } else {
      await admin.from("invites").insert({ email: em, kind, community_id, invited_by: caller.email });
    }

    // members: attach the profile (created by the on_auth_user_created trigger)
    if (kind === "member" && userId) {
      await admin.from("profiles").upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true });
      const { error: mErr } = await admin.from("community_members")
        .upsert({ community_id, profile_id: userId, status: "member" },
          { onConflict: "community_id,profile_id", ignoreDuplicates: true });
      if (mErr) return json({ error: "Emailed, but membership failed: " + mErr.message }, 400);
    }

    return json({ ok: true, emailed, existing: emailed === "magiclink" });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
