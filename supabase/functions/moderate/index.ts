// moderate — owner-only user moderation: ban, unban, remove.
//
// POST { action: "ban" | "unban" | "remove", profile_id?, email?, reason? }
//
//  · ban    → GoTrue ban (no future sign-ins), revoke refresh tokens,
//             strip community memberships + non-owner staff rows + push
//             subscriptions, record in bans (email-keyed — also blocks
//             re-invites via the invite function).
//  · unban  → lift the GoTrue ban + delete the bans row. Memberships are
//             NOT restored automatically.
//  · remove → permanently delete the auth account (cascades profile).
//             Without a ban, the address could sign up again — the console
//             offers ban+remove together for a true ejection.
//
// Deployed with: supabase functions deploy moderate --project-ref pjxvvwcnjjizdtiutpxd

import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(URL, SRK);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    // ---- caller must be an owner ----
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user: caller } } = await admin.auth.getUser(jwt);
    if (!caller?.email) return json({ error: "Not signed in" }, 401);
    const { data: staff } = await admin.from("staff").select("email, role");
    const isOwner = (staff || []).some((s) =>
      s.role === "owner" && s.email?.toLowerCase() === caller.email!.toLowerCase());
    if (!isOwner) return json({ error: "Owners only" }, 403);

    const { action, profile_id = null, email = null, reason = null } = await req.json();
    if (!["ban", "unban", "remove"].includes(action)) return json({ error: "Bad action" }, 400);

    // ---- resolve the target user ----
    let uid = profile_id, em = (email || "").trim().toLowerCase() || null;
    if (!uid && em) {
      // generateLink resolves email → user without sending anything
      const { data: gl, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: em });
      if (error || !gl?.user) return json({ error: "No account with that email" }, 404);
      uid = gl.user.id;
    }
    if (!uid) return json({ error: "profile_id or email required" }, 400);
    const { data: target } = await admin.auth.admin.getUserById(uid);
    if (!target?.user) return json({ error: "User not found" }, 404);
    em = target.user.email!.toLowerCase();
    if (em === caller.email!.toLowerCase()) return json({ error: "You can't moderate yourself" }, 400);
    const targetIsOwner = (staff || []).some((s) =>
      s.role === "owner" && s.email?.toLowerCase() === em);
    if (targetIsOwner) return json({ error: "Owners can't be banned or removed" }, 400);

    if (action === "ban") {
      const { error: banErr } = await admin.auth.admin.updateUserById(uid, { ban_duration: "876000h" });
      if (banErr) return json({ error: banErr.message }, 400);
      // revoke refresh tokens so existing sessions die at access-token expiry
      await fetch(`${URL}/auth/v1/admin/users/${uid}/logout`, {
        method: "POST", headers: { apikey: SRK, Authorization: `Bearer ${SRK}` },
      }).catch(() => {});
      await admin.from("bans").upsert({
        email: em, profile_id: uid, reason, banned_by: caller.email,
      }, { onConflict: "email" });
      await admin.from("community_members").delete().eq("profile_id", uid);
      await admin.from("staff").delete().eq("email", em).neq("role", "owner");
      await admin.from("push_subscriptions").delete().eq("profile_id", uid);
      return json({ ok: true, banned: em });
    }

    if (action === "unban") {
      const { error: unErr } = await admin.auth.admin.updateUserById(uid, { ban_duration: "none" });
      if (unErr) return json({ error: unErr.message }, 400);
      await admin.from("bans").delete().eq("email", em);
      return json({ ok: true, unbanned: em });
    }

    // remove — permanent account deletion
    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) return json({ error: delErr.message }, 400);
    return json({ ok: true, removed: em });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
