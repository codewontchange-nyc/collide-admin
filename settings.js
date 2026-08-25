import { useState } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Modal, CITIES } from "./ui.js?v=9";

export function SettingsPage({ client, community, isOwner, session, flash }) {
  const [f, setF] = useState({
    name: community.name || "",
    description: community.description || "",
    price: community.membership_price_cents ? (community.membership_price_cents / 100) : "",
    city: community.city || "nyc",
  });
  const [creating, setCreating] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    const { error } = await client.from("communities").update({
      name: f.name.trim(),
      description: f.description.trim() || null,
      membership_price_cents: Math.round((parseFloat(f.price) || 0) * 100),
      city: f.city,
    }).eq("id", community.id);
    if (error) flash(error.message);
    else { flash("Saved — refresh to see it everywhere"); }
  };

  return html`<div class="page" style="max-width:560px">
    <h2>Settings</h2>
    <form onSubmit=${save}>
      <div class="field"><label>Community name</label><input required value=${f.name} onInput=${set("name")} /></div>
      <div class="field"><label>Description</label><textarea rows="3" value=${f.description} onInput=${set("description")}></textarea></div>
      <div class="field"><label>City</label>
        <select value=${f.city} onChange=${set("city")}>
          ${CITIES.map(([v, l]) => html`<option value=${v}>${l}</option>`)}
        </select>
        <p class="tiny muted" style="margin:5px 0 0">Members see this community on its city's map.</p></div>
      <div class="field"><label>Membership price ($ / month, display-only for now)</label>
        <input type="number" min="0" step="0.01" value=${f.price} onInput=${set("price")} placeholder="5" /></div>
      <div class="actions" style="justify-content:flex-start">
        <button class="btn">Save settings</button>
      </div>
    </form>
    ${isOwner && html`<div style="margin-top:36px;padding-top:20px;border-top:1px solid var(--line)">
      <div class="section-label">Owner tools</div>
      <button class="btn ghost" onClick=${() => setCreating(true)}>+ Create a new community</button>
      <p class="tiny muted" style="margin-top:8px">Facilitators are managed per-community on the Members page.</p>
    </div>`}
    ${creating && html`<${CreateModal} client=${client} session=${session} flash=${flash} onClose=${() => setCreating(false)} />`}
  </div>`;
}

function CreateModal({ client, session, flash, onClose }) {
  const [name, setName] = useState("");
  const save = async (e) => {
    e.preventDefault();
    const { data, error } = await client.from("communities")
      .insert({ name: name.trim(), owner_id: session.user.id }).select().single();
    if (error) { flash(error.message); return; }
    // put the creator in the roster too
    await client.from("community_members").insert({ community_id: data.id, profile_id: session.user.id, status: "member" }).then(() => {});
    localStorage.setItem("ca.comm", data.id);
    flash("Community created 🎉");
    location.reload();
  };
  return html`<${Modal} title="New community" onClose=${onClose}>
    <form onSubmit=${save}>
      <div class="field"><label>Name</label><input required value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Oyster Expedition" /></div>
      <div class="actions">
        <button type="button" class="btn ghost" onClick=${onClose}>Cancel</button>
        <button class="btn">Create</button>
      </div>
    </form>
  </${Modal}>`;
}
