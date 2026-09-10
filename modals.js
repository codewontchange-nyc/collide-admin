import { useState } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Modal, CITIES, DEFAULT_CITY, toCents } from "./ui.js?v=__V__";
import { sendInvite, sendModerate, showError, ENV } from "./db.js?v=__V__";

/* The dialogs more than one page opens. Each exists exactly once here:
   Settings and the Data page used to carry their own copies of "new
   community" and "invite", with the owner-membership seed drifting apart. */

/* New community — the creator becomes owner AND lands in the roster.
   `full` shows emoji / city / price / description; Settings uses the short form. */
export function CommunityModal({ client, session, flash, onClose, full = true }) {
  const [f, setF] = useState({ name: "", emoji: "", city: DEFAULT_CITY, description: "", price: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const row = { name: f.name.trim(), owner_id: session.user.id };
    if (full) Object.assign(row, { emoji: f.emoji.trim() || null, city: f.city, description: f.description.trim() || null, membership_price_cents: toCents(f.price) });
    const { data, error } = await client.from("communities").insert(row).select().single();
    if (error) { setBusy(false); showError(flash, "New community", error); return; }
    // put the creator in the roster too — an owner missing from their own community is a support ticket
    const { error: memErr } = await client.from("community_members").insert({ community_id: data.id, profile_id: session.user.id, status: "member" });
    if (memErr) { setBusy(false); showError(flash, "Community made, but adding you as a member failed", memErr); return; }
    localStorage.setItem("ca.comm", data.id);
    flash("Community created 🎉");
    setTimeout(() => location.reload(), 600);   // refresh pickers everywhere
  };
  return html`<${Modal} title="New community" onClose=${onClose}>
    <form onSubmit=${save}>
      ${full
        ? html`<div class="fieldrow">
            <div class="field" style="flex:0 0 90px"><label>Emoji</label><input value=${f.emoji} onInput=${set("emoji")} placeholder="🏘️" /></div>
            <div class="field"><label>Name</label><input required value=${f.name} onInput=${set("name")} placeholder="Oyster Expedition" /></div>
          </div>
          <div class="fieldrow">
            <div class="field"><label>City</label>
              <select value=${f.city} onChange=${set("city")}>${CITIES.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select></div>
            <div class="field"><label>Membership $ / month</label>
              <input type="number" min="0" step="0.01" value=${f.price} onInput=${set("price")} placeholder="0" /></div>
          </div>
          <div class="field"><label>Description</label><input value=${f.description} onInput=${set("description")} placeholder="What this crew is about" /></div>`
        : html`<div class="field"><label>Name</label><input required value=${f.name} onInput=${set("name")} placeholder="Oyster Expedition" /></div>`}
      <div class="actions">
        <button type="button" class="btn ghost" onClick=${onClose}>Cancel</button>
        <button class="btn" disabled=${busy}>${busy ? "Creating…" : "Create community"}</button>
      </div>
    </form>
  </${Modal}>`;
}

/* Invite / add a member.
   - `community` (dashboard): fixed target, email invite + the share link
   - `communities` + `profiles` (Data page): pick the community; invite by email
     or attach an existing person directly */
export function InviteModal({ client, community, communities, profiles, flash, onClose, onSaved }) {
  const fixed = !!community;
  const [mode, setMode] = useState("email");
  const [f, setF] = useState({ email: "", profile_id: "", community_id: community?.id || communities?.[0]?.id || "", status: "member" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const target = fixed ? community : (communities || []).find((c) => c.id === f.community_id);
  const link = target ? `${ENV.APP_URL}/c/${target.id}` : "";
  const save = async (e) => {
    e.preventDefault();
    if (!f.community_id) { flash("Pick a community"); return; }
    setBusy(true);
    if (mode === "email") {
      const r = await sendInvite(client, { email: f.email.trim(), kind: "member", community_id: f.community_id });
      setBusy(false);
      if (r.error) { showError(flash, "Invite", r.error); return; }
      flash(r.existing ? "They already had an account — added, sign-in link sent 💌" : "Invite sent 💌");
      onSaved?.();
      return;
    }
    if (!f.profile_id) { setBusy(false); flash("Pick a person"); return; }
    const { error } = await client.from("community_members").insert({ community_id: f.community_id, profile_id: f.profile_id, status: f.status, joined_at: new Date().toISOString() });
    setBusy(false);
    if (error) { flash(error.message.includes("duplicate") ? "They're already in that community" : error.message); return; }
    flash("Member added ✓"); onSaved?.();
  };
  return html`<${Modal} title=${fixed ? "Invite members" : "Add member"} onClose=${onClose}>
    ${!fixed && html`<div class="subnav" style="margin-bottom:14px">
      <button type="button" class=${mode === "email" ? "on" : ""} onClick=${() => setMode("email")}>✉️ Invite by email</button>
      <button type="button" class=${mode === "existing" ? "on" : ""} onClick=${() => setMode("existing")}>Add existing person</button>
    </div>`}
    <form onSubmit=${save}>
      ${mode === "email"
        ? html`<div class="field"><label>Invite by email</label>
            <div class="u-row">
              <input class="u-grow" type="email" required placeholder="them@email.com" value=${f.email} onInput=${set("email")} />
              ${fixed && html`<button class="btn" disabled=${busy}>${busy ? "Sending…" : "Send invite"}</button>`}
            </div>
            <p class="tiny muted" style="margin:6px 0 0">They get a branded email with a magic sign-in link and land in <b>${target?.name || "the community"}</b> already a member.</p>
          </div>`
        : html`<div class="field"><label>Person</label>
            <select required value=${f.profile_id} onChange=${set("profile_id")}>
              <option value="">Choose…</option>
              ${(profiles || []).map((p) => html`<option value=${p.id}>${p.display_name || p.id.slice(0, 6)}</option>`)}
            </select></div>`}
      ${!fixed && html`<div class="fieldrow">
        <div class="field"><label>Community</label>
          <select required value=${f.community_id} onChange=${set("community_id")}>
            ${(communities || []).map((c) => html`<option value=${c.id}>${c.name}</option>`)}
          </select></div>
        ${mode === "existing" && html`<div class="field"><label>Status</label>
          <select value=${f.status} onChange=${set("status")}><option value="member">member</option><option value="pending">pending</option></select></div>`}
      </div>
      <div class="actions">
        <button type="button" class="btn ghost" onClick=${onClose}>Cancel</button>
        <button class="btn" disabled=${busy}>${busy ? "Sending…" : (mode === "email" ? "Send invite" : "Add member")}</button>
      </div>`}
    </form>
    ${fixed && html`<div style="border-top:1px solid var(--line);margin:16px 0 12px"></div>
      <p class="muted tiny" style="margin:0 0 8px">Or share this link — it opens <b>${target.name}</b> in the Collide app:</p>
      <div class="field"><input readonly value=${link} onFocus=${(e) => e.target.select()} /></div>
      <div class="actions"><button type="button" class="btn ghost" onClick=${() => { navigator.clipboard?.writeText(link); flash("Link copied 📋"); }}>Copy link</button></div>`}
  </${Modal}>`;
}

/* Ban an address that isn't sitting in a members row — goes through the
   moderate function (signs them out everywhere, strips memberships). */
export function BanModal({ client, flash, onClose, onSaved }) {
  const [f, setF] = useState({ email: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const res = await sendModerate(client, { action: "ban", email: f.email.trim(), reason: f.reason.trim() || null });
    setBusy(false);
    if (res.error) { showError(flash, "Ban", res.error); return; }
    flash(`Banned ${f.email.trim()} 🔨`);
    onSaved?.();
  };
  return html`<${Modal} title="Ban a user" onClose=${onClose}>
    <form onSubmit=${save}>
      <div class="field"><label>Email</label><input type="email" required placeholder="them@email.com" value=${f.email} onInput=${set("email")} /></div>
      <div class="field"><label>Reason</label><input value=${f.reason} onInput=${set("reason")} placeholder="Why — kept for the record" /></div>
      <p class="tiny muted">They're signed out everywhere, can't sign back in, lose all memberships, and can't be re-invited until unbanned.</p>
      <div class="actions">
        <button type="button" class="btn ghost" onClick=${onClose}>Cancel</button>
        <button class="btn danger" disabled=${busy}>${busy ? "Banning…" : "Ban user"}</button>
      </div>
    </form>
  </${Modal}>`;
}
