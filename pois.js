import { useState, useEffect, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Modal, mediaUrl, uploadMedia } from "./ui.js";
import { MapView } from "./map-widget.js";

export function PoisPage({ client, community, session, flash }) {
  const [pois, setPois] = useState([]);
  const [editing, setEditing] = useState(null);   // null | {} | poi row

  const load = useCallback(async () => {
    const { data } = await client.from("pois").select("*").eq("community_id", community.id).order("created_at", { ascending: false });
    setPois(data || []);
  }, [client, community.id]);
  useEffect(() => { load(); }, [load]);

  const remove = async (p) => {
    if (!confirm(`Delete "${p.name}"?`)) return;
    const { error } = await client.from("pois").delete().eq("id", p.id);
    if (error) flash(error.message); else { flash("Deleted"); load(); }
  };

  return html`<div class="page">
    <div class="pagehead">
      <h2 style="margin:0">Points of Interest <span class="muted" style="font:400 15px Inter">${pois.length}</span></h2>
      <button class="btn" onClick=${() => setEditing({})}>+ New POI</button>
    </div>
    <div class="dash" style="grid-template-columns:380px 1fr">
      <div class="mapcard" style="position:static"><${MapView} className="lmap" pins=${pois.map((p) => ({ lat: p.lat, lng: p.lng, label: p.name, color: "#219a8f" }))} /></div>
      <div class="poigrid" style="grid-template-columns:repeat(4,1fr);align-content:start">
        ${pois.map((p) => html`<div class="poi">
          <div class="disc" onClick=${() => setEditing(p)} style="cursor:pointer">${p.image_path ? html`<img src=${mediaUrl(client, p.image_path)} alt="" />` : "📍"}</div>
          <div class="n">${p.name}</div>
          ${p.category && html`<div class="c">${p.category}</div>`}
          <button class="linkbtn tiny" onClick=${() => remove(p)}>delete</button>
        </div>`)}
        ${pois.length === 0 && html`<div class="empty" style="grid-column:1/-1">Pin the community's favorite spots — cafés, trailheads, picnic tables 📍</div>`}
      </div>
    </div>
    ${editing && html`<${PoiModal} client=${client} community=${community} session=${session} poi=${editing.id ? editing : null}
      flash=${flash} onClose=${() => setEditing(null)} onSaved=${() => { setEditing(null); load(); }} />`}
  </div>`;
}

function PoiModal({ client, community, session, poi, flash, onClose, onSaved }) {
  const [f, setF] = useState({ name: poi?.name || "", category: poi?.category || "", notes: poi?.notes || "" });
  const [picked, setPicked] = useState(poi?.lat != null ? { lat: poi.lat, lng: poi.lng } : null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    if (!picked) { flash("Click the map to place the pin 📍"); return; }
    setBusy(true);
    try {
      let image_path = poi?.image_path || null;
      if (file) image_path = await uploadMedia(client, "poi", file);
      const row = {
        community_id: community.id, name: f.name.trim(), category: f.category.trim() || null,
        notes: f.notes.trim() || null, lat: picked.lat, lng: picked.lng, image_path,
        created_by: poi?.created_by || session.user.id,
      };
      const q = poi ? client.from("pois").update(row).eq("id", poi.id) : client.from("pois").insert(row);
      const { error } = await q;
      if (error) throw error;
      flash(poi ? "POI updated" : "POI pinned 📍");
      onSaved();
    } catch (err) { flash(err.message || String(err)); }
    setBusy(false);
  };

  return html`<${Modal} title=${poi ? "Edit POI" : "New point of interest"} onClose=${onClose}>
    <form onSubmit=${save}>
      <div class="fieldrow">
        <div class="field"><label>Name</label><input required value=${f.name} onInput=${set("name")} placeholder="Our Fav Coffee" /></div>
        <div class="field"><label>Category</label><input value=${f.category} onInput=${set("category")} placeholder="Coffee · Trail · Food…" /></div>
      </div>
      <div class="field"><label>Pin on map — click to place</label>
        <${MapView} className="pickmap" onPick=${setPicked} picked=${picked} center=${picked ? [picked.lat, picked.lng] : null} />
        ${picked && html`<div class="tiny muted">📍 ${picked.lat.toFixed(4)}, ${picked.lng.toFixed(4)}</div>`}
      </div>
      <div class="field"><label>Notes</label><textarea rows="2" value=${f.notes} onInput=${set("notes")} placeholder="Why this spot matters"></textarea></div>
      <div class="field"><label>Image</label><input type="file" accept="image/*" onChange=${(e) => setFile(e.target.files[0] || null)} /></div>
      <div class="actions">
        <button type="button" class="btn ghost" onClick=${onClose}>Cancel</button>
        <button class="btn" disabled=${busy}>${busy ? "Saving…" : "Save POI"}</button>
      </div>
    </form>
  </${Modal}>`;
}
