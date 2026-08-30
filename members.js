import { useState, useEffect, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Avatar, Modal, niceDate } from "./ui.js?v=24";
import { sendInvite } from "./datatable.js?v=24";

const APP_URL = "https://codewontchange-nyc.github.io/Collide";

export function MembersPage({ client, community, isOwner, flash }) {
  const [rows, setRows] = useState(null);   // null = loading
  const [staff, setStaff] = useState([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [staffOpen, setStaffOpen] = useState(false);

  const load = useCallback(async () => {
    const [m, s] = await Promise.all([
      client.from("community_members")
        .select("status, joined_at, profile:profiles!community_members_profile_id_fkey(id,display_name,avatar_url)")
        .eq("community_id", community.id).order("joined_at"),
      client.from("staff").select("*"),
    ]);
    setRows(m.data || []);
    setStaff((s.data || []).filter((x) => x.community_id === community.id || x.community_id === null));
  }, [client, community.id]);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (r, status) => {
    const { error } = await client.from("community_members").update({ status })
      .eq("community_id", community.id).eq("profile_id", r.profile.id);
    if (error) flash(error.message); else { flash(status === "member" ? "Approved ✓" : "Updated"); load(); }
  };
  const remove = async (r) => {
    if (!confirm(`Remove ${r.profile?.display_name || "this member"} from ${community.name}?`)) return;
    const { error } = await client.from("community_members").delete()
      .eq("community_id", community.id).eq("profile_id", r.profile.id);
    if (error) flash(error.message); else { flash("Member removed"); load(); }
  };

  const staffEmails = new Set(staff.map((s) => s.email?.toLowerCase()));

  return html`<div class="page">
    <div class="pagehead">
      <h2 style="margin:0">Members <span class="muted" style="font:400 15px Inter">${rows === null ? "…" : rows.length}</span></h2>
      <div style="display:flex;gap:10px">
        ${isOwner && html`<button class="btn ghost" onClick=${() => setStaffOpen(true)}>Facilitators</button>`}
        <button class="btn" onClick=${() => setInviteOpen(true)}>Invite</button>
      </div>
    </div>
    <table class="table">
      <thead><tr><th></th><th>Member</th><th>Joined</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${(rows || []).map((r) => html`<tr>
          <td style="width:40px"><${Avatar} profile=${r.profile} /></td>
          <td><b>${r.profile?.display_name || "—"}</b></td>
          <td class="muted">${r.joined_at ? niceDate(r.joined_at.slice(0, 10)) : "—"}</td>
          <td><span class=${"pillstat " + r.status}>${r.status}</span></td>
          <td class="rowactions">
            ${r.status === "pending" && html`<button class="btn small" onClick=${() => setStatus(r, "member")}>Approve</button>`}
            <button class="btn small danger" onClick=${() => remove(r)}>Remove</button>
          </td>
        </tr>`)}
      </tbody>
    </table>
    ${rows === null && html`<div class="empty" style="border:0;margin-top:12px">Loading…</div>`}
    ${rows !== null && rows.length === 0 && html`<div class="empty" style="margin-top:12px">No members yet — share the invite link 💌</div>`}

    ${inviteOpen && html`<${InviteModal} client=${client} community=${community} flash=${flash}
      onClose=${() => setInviteOpen(false)} onSaved=${() => { setInviteOpen(false); load(); }} />`}

    ${staffOpen && html`<${StaffModal} client=${client} community=${community} staff=${staff} flash=${flash}
      onClose=${() => { setStaffOpen(false); load(); }} />`}
  </div>`;
}

/* Members: invite by email (branded magic-link invite, auto-added to this
   community) — the share link stays as a fallback. */
function InviteModal({ client, community, flash, onClose, onSaved }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const link = `${APP_URL}/c/${community.id}`;
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    const r = await sendInvite(client, { email, kind: "member", community_id: community.id });
    setBusy(false);
    if (r.error) { flash(r.error); return; }
    flash(r.existing ? "They already had an account — added, sign-in link sent 💌" : "Invite sent 💌");
    onSaved();
  };
  return html`<${Modal} title="Invite members" onClose=${onClose}>
    <form onSubmit=${send}>
      <div class="field"><label>Invite by email</label>
        <div style="display:flex;gap:10px">
          <input style="flex:1" type="email" required placeholder="them@email.com" value=${email} onInput=${(e) => setEmail(e.target.value)} />
          <button class="btn" disabled=${busy}>${busy ? "Sending…" : "Send invite"}</button>
        </div>
        <p class="tiny muted" style="margin:6px 0 0">They get a branded email with a magic sign-in link and land in <b>${community.name}</b> already a member.</p>
      </div>
    </form>
    <div style="border-top:1px solid var(--line);margin:16px 0 12px"></div>
    <p class="muted tiny" style="margin:0 0 8px">Or share this link — it opens <b>${community.name}</b> in the Collide app:</p>
    <div class="field"><input readonly value=${link} onFocus=${(e) => e.target.select()} /></div>
    <div class="actions">
      <button class="btn ghost" onClick=${() => { navigator.clipboard?.writeText(link); flash("Link copied 📋"); }}>Copy link</button>
    </div>
  </${Modal}>`;
}

/* Owner-only: manage who can use this console for this community.
   Adding routes through the invite function → staff row + the special
   facilitator email with a magic link into the console. */
function StaffModal({ client, community, staff, flash, onClose }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState(staff);

  const reload = async () => {
    const { data } = await client.from("staff").select("*");
    setRows((data || []).filter((x) => x.community_id === community.id || x.community_id === null));
  };
  const add = async (e) => {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!em) return;
    setBusy(true);
    const r = await sendInvite(client, { email: em, kind: "facilitator", community_id: community.id });
    setBusy(false);
    if (r.error) { flash(r.error); return; }
    flash(r.existing ? "Added to staff — sign-in link sent to their inbox 💌" : "Facilitator invite sent 💌");
    setEmail(""); reload();
  };
  const drop = async (r) => {
    if (r.role === "owner") { flash("Owners can't be removed here"); return; }
    const { error } = await client.from("staff").delete().eq("id", r.id);
    if (error) flash(error.message); else { flash("Removed"); reload(); }
  };

  return html`<${Modal} title=${`Facilitators — ${community.name}`} onClose=${onClose}>
    <form onSubmit=${add} style="display:flex;gap:10px;margin-bottom:14px">
      <input style="flex:1;padding:10px 12px;border:1px solid var(--line);border-radius:9px" type="email" placeholder="facilitator@email.com" value=${email} onInput=${(e) => setEmail(e.target.value)} />
      <button class="btn" disabled=${busy}>${busy ? "Sending…" : "Invite"}</button>
    </form>
    <table class="table"><tbody>
      ${(rows || []).map((r) => html`<tr>
        <td>${r.email}</td>
        <td><span class=${"pillstat " + r.role}>${r.role}${r.community_id === null ? " · all communities" : ""}</span></td>
        <td class="rowactions">${r.role !== "owner" && html`<button class="btn small danger" onClick=${() => drop(r)}>Remove</button>`}</td>
      </tr>`)}
    </tbody></table>
  </${Modal}>`;
}
