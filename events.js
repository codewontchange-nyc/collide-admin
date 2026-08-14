import { useState, useEffect, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Avatar, Modal, niceDate, niceTime, mediaUrl, uploadMedia, moneyExact, todayStr } from "./ui.js";
import { MapView } from "./map-widget.js";

export function EventsPage({ client, community, session, flash }) {
  const [events, setEvents] = useState([]);
  const [showPast, setShowPast] = useState(false);
  const [editing, setEditing] = useState(null);    // null | {} (new) | event row
  const [roster, setRoster] = useState(null);      // event whose RSVPs are open

  const load = useCallback(async () => {
    const q = client.from("activities").select("*").eq("community_id", community.id).order("date", { ascending: !showPast });
    const { data } = showPast ? await q.lt("date", todayStr()) : await q.gte("date", todayStr());
    setEvents(data || []);
  }, [client, community.id, showPast]);
  useEffect(() => { load(); }, [load]);

  const remove = async (ev) => {
    if (!confirm(`Delete "${ev.title}"? Members will see it disappear from the app.`)) return;
    const { error } = await client.from("activities").delete().eq("id", ev.id);
    if (error) flash(error.message); else { flash("Event deleted"); load(); }
  };

  return html`<div class="page">
    <div class="pagehead">
      <h2 style="margin:0">Events</h2>
      <div style="display:flex;gap:10px;align-items:center">
        <button class="linkbtn tiny" onClick=${() => setShowPast(!showPast)}>${showPast ? "show upcoming" : "show past"}</button>
        <button class="btn" onClick=${() => setEditing({})}>+ New event</button>
      </div>
    </div>
    <div class="evlist">
      ${events.map((e) => html`<div class="evcard">
        ${e.image_path ? html`<img class="thumb" src=${mediaUrl(client, e.image_path)} alt="" />` : html`<div class="thumb">🗓️</div>`}
        <div style="flex:1">
          <div class="t">${e.title}${e.price_cents > 0 && html` <span class="pillstat">${moneyExact(e.price_cents)}</span>`}</div>
          <div class="d">${niceDate(e.date || "")}${e.starts_at ? " · " + niceTime(e.starts_at) : ""}${e.location ? " · 📍 " + e.location : ""}</div>
        </div>
        <div class="rowactions">
          <button class="btn small ghost" onClick=${() => setRoster(e)}>RSVPs</button>
          <button class="btn small ghost" onClick=${() => setEditing(e)}>Edit</button>
          <button class="btn small danger" onClick=${() => remove(e)}>Delete</button>
        </div>
      </div>`)}
      ${events.length === 0 && html`<div class="empty">${showPast ? "No past events." : "Nothing coming up — plan something 🎉"}</div>`}
    </div>
    ${editing && html`<${EventModal} client=${client} community=${community} session=${session}
      event=${editing.id ? editing : null} flash=${flash}
      onClose=${() => setEditing(null)} onSaved=${() => { setEditing(null); load(); }} />`}
    ${roster && html`<${RosterModal} client=${client} event=${roster} flash=${flash} onClose=${() => setRoster(null)} />`}
  </div>`;
}

function EventModal({ client, community, session, event, flash, onClose, onSaved }) {
  const [f, setF] = useState({
    title: event?.title || "", date: event?.date || todayStr(), starts_at: event?.starts_at || "",
    location: event?.location || "", price: event ? (event.price_cents / 100 || "") : "",
  });
  const [picked, setPicked] = useState(event?.lat != null ? { lat: event.lat, lng: event.lng } : null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // The mobile app renders when_bucket / at_time / place — write BOTH the
  // admin fields and the app-native ones so events look identical everywhere.
  const whenBucket = (dateStr) => {
    const days = Math.round((new Date(dateStr + "T00:00:00") - new Date(new Date().toDateString())) / 864e5);
    if (days <= 0) return "today";
    if (days === 1) return "tomorrow";
    const dow = new Date(dateStr + "T00:00:00").getDay();
    if (days <= 7) return (dow === 0 || dow >= 5) ? "this_weekend" : "this_week";
    if (days <= 14) return "next_week";
    return "someday";
  };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      let image_path = event?.image_path || null;
      if (file) image_path = await uploadMedia(client, "ev", file);
      const row = {
        community_id: community.id, host_id: event?.host_id || session.user.id,
        title: f.title.trim(), date: f.date || null, starts_at: f.starts_at || null,
        location: f.location.trim() || null, lat: picked?.lat ?? null, lng: picked?.lng ?? null,
        image_path, price_cents: Math.round((parseFloat(f.price) || 0) * 100),
        // app-native mirrors
        place: f.location.trim() || null,
        at_time: f.starts_at ? niceTime(f.starts_at) : null,
        when_bucket: f.date ? whenBucket(f.date) : null,
        visibility: "public",
        expires_at: f.date ? new Date(new Date(f.date + "T23:59:00").getTime() + 864e5).toISOString() : null,
      };
      const q = event
        ? client.from("activities").update(row).eq("id", event.id)
        : client.from("activities").insert(row);
      const { error } = await q;
      if (error) throw error;
      flash(event ? "Event updated" : "Event created — it's live in the app ✨");
      onSaved();
    } catch (err) { flash(err.message || String(err)); }
    setBusy(false);
  };

  return html`<${Modal} title=${event ? "Edit event" : "New event"} onClose=${onClose}>
    <form onSubmit=${save}>
      <div class="field"><label>Title</label><input required value=${f.title} onInput=${set("title")} placeholder="Eagle Rock Hike" /></div>
      <div class="fieldrow">
        <div class="field"><label>Date</label><input type="date" required value=${f.date} onInput=${set("date")} /></div>
        <div class="field"><label>Start time</label><input type="time" value=${f.starts_at} onInput=${set("starts_at")} /></div>
        <div class="field"><label>Price (optional)</label><input type="number" min="0" step="0.01" value=${f.price} onInput=${set("price")} placeholder="0" /></div>
      </div>
      <div class="field"><label>Location name</label><input value=${f.location} onInput=${set("location")} placeholder="Eagle Rock Trailhead" /></div>
      <div class="field"><label>Pin on map — click to place</label>
        <${MapView} className="pickmap" onPick=${setPicked} picked=${picked}
          center=${picked ? [picked.lat, picked.lng] : null} />
        ${picked && html`<div class="tiny muted">📍 ${picked.lat.toFixed(4)}, ${picked.lng.toFixed(4)}</div>`}
      </div>
      <div class="field"><label>Image</label><input type="file" accept="image/*" onChange=${(e) => setFile(e.target.files[0] || null)} /></div>
      <div class="actions">
        <button type="button" class="btn ghost" onClick=${onClose}>Cancel</button>
        <button class="btn" disabled=${busy}>${busy ? "Saving…" : "Save event"}</button>
      </div>
    </form>
  </${Modal}>`;
}

function RosterModal({ client, event, flash, onClose }) {
  const [rows, setRows] = useState([]);
  const load = useCallback(async () => {
    const { data } = await client.from("rsvps")
      .select("status, created_at, profile:profiles!rsvps_profile_id_fkey(id,display_name,avatar_url)")
      .eq("activity_id", event.id).order("created_at");
    setRows(data || []);
  }, [client, event.id]);
  useEffect(() => { load(); }, [load]);

  const kick = async (r) => {
    if (!confirm(`Remove ${r.profile?.display_name || "this member"} from "${event.title}"?`)) return;
    const { error } = await client.from("rsvps").delete().eq("activity_id", event.id).eq("profile_id", r.profile.id);
    if (error) flash(error.message); else { flash("Removed"); load(); }
  };

  return html`<${Modal} title=${`RSVPs — ${event.title}`} onClose=${onClose}>
    <table class="table"><thead><tr><th></th><th>Member</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((r) => html`<tr>
        <td style="width:36px"><${Avatar} profile=${r.profile} size="sm" /></td>
        <td>${r.profile?.display_name || "—"}</td>
        <td><span class=${"pillstat " + (r.status === "going" ? "member" : "")}>${r.status}</span></td>
        <td class="rowactions"><button class="btn small danger" onClick=${() => kick(r)}>Remove</button></td>
      </tr>`)}
    </tbody></table>
    ${rows.length === 0 && html`<div class="empty" style="margin-top:10px">No RSVPs yet.</div>`}
  </${Modal}>`;
}
