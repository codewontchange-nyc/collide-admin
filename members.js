import { useState } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Page, Avatar, Modal, Pill, Loading, Empty, LoadError, niceDate, confirmDanger } from "./ui.js?v=__V__";
import { useLoader, sendInvite, COLS, firstError, showError } from "./db.js?v=__V__";
import { InviteModal } from "./modals.js?v=__V__";

export function MembersPage({ client, community, isOwner, flash }) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [staffOpen, setStaffOpen] = useState(false);

  const { data, error, reload } = useLoader(async () => {
    const [m, s] = await Promise.all([
      client.from("community_members")
        .select("status, joined_at, profile:profiles!community_members_profile_id_fkey(id,display_name,avatar_url)")
        .eq("community_id", community.id).order("joined_at"),
      client.from("staff").select(COLS.staff),
    ]);
    const err = firstError([m, s]); if (err) return { error: err };
    return { data: { rows: m.data || [], staff: (s.data || []).filter((x) => x.community_id === community.id || x.community_id === null) } };
  }, [client, community.id], { flash, where: "Members" });
  const loading = data === null;
  const d = data && !Array.isArray(data) ? data : { rows: [], staff: [] };

  const setStatus = async (r, status) => {
    const { error: e } = await client.from("community_members").update({ status })
      .eq("community_id", community.id).eq("profile_id", r.profile.id);
    if (e) showError(flash, "Update member", e); else { flash(status === "member" ? "Approved ✓" : "Updated"); reload(); }
  };
  const remove = async (r) => {
    if (!confirmDanger(`Remove ${r.profile?.display_name || "this member"} from ${community.name}?`)) return;
    const { error: e } = await client.from("community_members").delete()
      .eq("community_id", community.id).eq("profile_id", r.profile.id);
    if (e) showError(flash, "Remove member", e); else { flash("Member removed"); reload(); }
  };

  return html`<${Page} title="Members" sub=${loading ? "…" : String(d.rows.length)}
    actions=${html`${isOwner && html`<button class="btn ghost" onClick=${() => setStaffOpen(true)}>Facilitators</button>`}
      <button class="btn" onClick=${() => setInviteOpen(true)}>Invite</button>`}>
    ${error ? html`<${LoadError} what="members" error=${error} onRetry=${reload} />`
      : loading ? html`<${Loading} />`
      : d.rows.length === 0 ? html`<${Empty}>No members yet — share the invite link 💌</${Empty}>`
      : html`<table class="table">
        <thead><tr><th></th><th>Member</th><th>Joined</th><th>Status</th><th></th></tr></thead>
        <tbody>${d.rows.map((r) => html`<tr>
          <td style="width:40px"><${Avatar} profile=${r.profile} /></td>
          <td><b>${r.profile?.display_name || "—"}</b></td>
          <td class="muted">${r.joined_at ? niceDate(r.joined_at.slice(0, 10)) : "—"}</td>
          <td><${Pill}>${r.status}</${Pill}></td>
          <td class="actions">
            ${r.status === "pending" && html`<button class="btn sm" onClick=${() => setStatus(r, "member")}>Approve</button>`}
            <button class="btn sm danger" onClick=${() => remove(r)}>Remove</button>
          </td>
        </tr>`)}</tbody>
      </table>`}

    ${inviteOpen && html`<${InviteModal} client=${client} community=${community} flash=${flash}
      onClose=${() => setInviteOpen(false)} onSaved=${() => { setInviteOpen(false); reload(); }} />`}
    ${staffOpen && html`<${StaffModal} client=${client} community=${community} staff=${d.staff} flash=${flash}
      onClose=${() => { setStaffOpen(false); reload(); }} />`}
  </${Page}>`;
}

/* Owner-only: manage who can use this console for this community.
   Adding routes through the invite function → staff row + the special
   facilitator email with a magic link into the console. Owner keys can't be
   pulled here (and the DB refuses too). */
function StaffModal({ client, community, staff, flash, onClose }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState(staff);

  const reload = async () => {
    const { data, error } = await client.from("staff").select(COLS.staff);
    if (error) { showError(flash, "Staff", error); return; }
    setRows((data || []).filter((x) => x.community_id === community.id || x.community_id === null));
  };
  const add = async (e) => {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!em) return;
    setBusy(true);
    const r = await sendInvite(client, { email: em, kind: "facilitator", community_id: community.id });
    setBusy(false);
    if (r.error) { showError(flash, "Invite", r.error); return; }
    flash(r.existing ? "Added to staff — sign-in link sent to their inbox 💌" : "Facilitator invite sent 💌");
    setEmail(""); reload();
  };
  const drop = async (r) => {
    if (r.role === "owner") { flash("Owners can't be removed here"); return; }
    if (!confirmDanger(`Remove ${r.email}'s facilitator key?`)) return;
    const { error } = await client.from("staff").delete().eq("id", r.id).neq("role", "owner");
    if (error) showError(flash, "Remove key", error); else { flash("Removed"); reload(); }
  };

  return html`<${Modal} title=${`Facilitators — ${community.name}`} onClose=${onClose}>
    <form onSubmit=${add} class="u-row" style="margin-bottom:14px">
      <input class="u-grow" style="padding:10px 12px;border:1px solid var(--line);border-radius:9px" type="email" placeholder="facilitator@email.com" value=${email} onInput=${(e) => setEmail(e.target.value)} />
      <button class="btn" disabled=${busy}>${busy ? "Sending…" : "Invite"}</button>
    </form>
    <table class="table"><tbody>
      ${(rows || []).map((r) => html`<tr>
        <td>${r.email}</td>
        <td><${Pill} tone="brand">${r.role}${r.community_id === null ? " · all communities" : ""}</${Pill}></td>
        <td class="actions">${r.role !== "owner" && html`<button class="btn sm danger" onClick=${() => drop(r)}>Remove</button>`}</td>
      </tr>`)}
    </tbody></table>
  </${Modal}>`;
}
