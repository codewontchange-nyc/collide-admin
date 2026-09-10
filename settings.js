import { useState } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Page, CITIES, DEFAULT_CITY, toCents } from "./ui.js?v=__V__";
import { showError } from "./db.js?v=__V__";
import { CommunityModal } from "./modals.js?v=__V__";

export function SettingsPage({ client, community, isOwner, session, flash }) {
  const [f, setF] = useState({
    name: community.name || "",
    description: community.description || "",
    price: community.membership_price_cents ? (community.membership_price_cents / 100) : "",
    city: community.city || DEFAULT_CITY,
  });
  const [creating, setCreating] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    const { error } = await client.from("communities").update({
      name: f.name.trim(),
      description: f.description.trim() || null,
      membership_price_cents: toCents(f.price),
      city: f.city,
    }).eq("id", community.id);
    if (error) showError(flash, "Settings", error);
    else flash("Saved — refresh to see it everywhere");
  };

  return html`<${Page} title="Settings">
    <div class="narrow">
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
    ${isOwner && html`<div class="u-mt-3" style="padding-top:20px;border-top:1px solid var(--line)">
      <div class="section-label">Owner tools</div>
      <button class="btn ghost" onClick=${() => setCreating(true)}>+ Create a new community</button>
      <p class="tiny muted u-mt-1">Facilitators are managed per-community on the Members page.</p>
    </div>`}
    ${creating && html`<${CommunityModal} client=${client} session=${session} flash=${flash} onClose=${() => setCreating(false)} />`}
    </div>
  </${Page}>`;
}
