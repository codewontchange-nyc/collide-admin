import { useState, useEffect, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Avatar, Modal, niceDate } from "./ui.js?v=3";

const APP_URL = "https://codewontchange-nyc.github.io/Collide";

export function MembersPage({ client, community, isOwner, flash }) {
  const [rows, setRows] = useState([]);
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
      <h2 style="margin:0">Members <span class="muted" style="font:400 15px Inter">${rows.length}</span></h2>
      <div style="display:flex;gap:10px">
        ${isOwner && html`<button class="btn ghost" onClick=${() => setStaffOpen(true)}>Facilitators</button>`}
        <button class="btn" onClick=${() => setInviteOpen(true)}>Invite</button>
      </div>
    </div>
    <table class="table">
      <thead><tr><th></th><th>Member</th><th>Joined</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${rows.map((r) => html`<tr>
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
    ${rows.length === 0 && html`<div class="empty" style="margin-top:12px">No members yet — share the invite link 💌</div>`}

    ${inviteOpen && html`<${Modal} title="Invite members" onClose=${() => setInviteOpen(false)}>
      <p class="muted">Share this link — it opens <b>${community.name}</b> in the Collide app:</p>
      <div class="field"><input readonly value=${`${APP_URL}/c/${community.id}`} onFocus=${(e) => e.target.select()} /></div>
      <div class="actions">
        <button class="btn" onClick=${() => { navigator.clipboard?.writeText(`${APP_URL}/c/${community.id}`); flash("Link copied 📋"); }}>Copy link</button>
      </div>
    </${Modal}>`}

    ${staffOpen && html`<${StaffModal} client=${client} community=${community} staff=${staff} flash=${flash}
      onClose=${() => { setStaffOpen(false); load(); }} />`}
  </div>`;
}

/* Owner-only: manage who can use this console for this community. */
function StaffModal({ client, community, staff, flash, onClose }) {
  const [email, setEmail] = useState("");
  const [rows, setRows] = useState(staff);

  const reload = async () => {
    const { data } = await client.from("staff").select("*");
    setRows((data || []).filter((x) => x.community_id === community.id || x.community_id === null));
  };
  const add = async (e) => {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!em) return;
    const { error } = await client.from("staff").insert({ email: em, role: "facilitator", community_id: community.id });
    if (error) flash(error.message);
    else { flash("Facilitator added — they can sign in now"); setEmail(""); reload(); }
  };
  const drop = async (r) => {
    if (r.role === "owner") { flash("Owners can't be removed here"); return; }
    const { error } = await client.from("staff").delete().eq("id", r.id);
    if (error) flash(error.message); else { flash("Removed"); reload(); }
  };

  return html`<${Modal} title=${`Facilitators — ${community.name}`} onClose=${onClose}>
    <form onSubmit=${add} style="display:flex;gap:10px;margin-bottom:14px">
      <input style="flex:1;padding:10px 12px;border:1px solid var(--line);border-radius:9px" type="email" placeholder="facilitator@email.com" value=${email} onInput=${(e) => setEmail(e.target.value)} />
      <button class="btn">Add</button>
    </form>
    <table class="table"><tbody>
      ${rows.map((r) => html`<tr>
        <td>${r.email}</td>
        <td><span class=${"pillstat " + r.role}>${r.role}${r.community_id === null ? " · all communities" : ""}</span></td>
        <td class="rowactions">${r.role !== "owner" && html`<button class="btn small danger" onClick=${() => drop(r)}>Remove</button>`}</td>
      </tr>`)}
    </tbody></table>
  </${Modal}>`;
}
