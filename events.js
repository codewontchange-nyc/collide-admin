import { useState } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Page, Avatar, Modal, Pill, Loading, Empty, LoadError, niceDate, niceTime, mediaUrl, uploadMedia, moneyExact, todayStr, toCents, isExpired, eventMirror, EVENT_CATEGORIES, DEFAULT_CITY, confirmDanger } from "./ui.js?v=__V__";
import { useLoader, fnUrl, showError } from "./db.js?v=__V__";

export function EventsPage({ client, community, session, flash }) {
  const [showPast, setShowPast] = useState(false);
  const [editing, setEditing] = useState(null);    // null | {} (new) | event row
  const [roster, setRoster] = useState(null);      // event whose RSVPs are open

  // One fetch, split client-side — phone-made plans often have no date (just a
  // when-bucket), and a date filter alone silently hid them from this page.
  const { data: events, error, reload } = useLoader(async () => {
    const { data, error: e } = await client.from("activities").select("*")
      .eq("community_id", community.id).order("created_at", { ascending: false }).limit(400);
    if (e) return { error: e };
    const all = data || [];
    const upcoming = all.filter((x) => x.date ? x.date >= todayStr() : !isExpired(x));
    const past = all.filter((x) => x.date ? x.date < todayStr() : isExpired(x));
    return { data: (showPast ? past : upcoming).sort((a, b) => (a.date || "9999") < (b.date || "9999") ? (showPast ? 1 : -1) : (showPast ? -1 : 1)) };
  }, [client, community.id, showPast], { flash, where: "Events" });

  const remove = async (ev) => {
    if (!confirmDanger(`Delete "${ev.title}"? Members will see it disappear from the app.`)) return;
    const { error: e } = await client.from("activities").delete().eq("id", ev.id);
    if (e) showError(flash, "Delete event", e); else { flash("Event deleted"); reload(); }
  };

  return html`<${Page} title="Events" actions=${html`
      <button class="btn link tiny" onClick=${() => setShowPast(!showPast)}>${showPast ? "show upcoming" : "show past"}</button>
      <button class="btn" onClick=${() => setEditing({})}>+ New event</button>`}>
    <div class="evlist">
      ${(events || []).map((e) => html`<div class="evcard">
        ${e.image_path ? html`<img class="thumb" src=${mediaUrl(client, e.image_path)} alt="" />` : html`<div class="thumb">🗓️</div>`}
        <div class="u-grow">
          <div class="t">${e.title}${e.price_cents > 0 && html` <${Pill} tone="neutral">${moneyExact(e.price_cents)}</${Pill}>`}${e.category && html` <${Pill} tone="neutral">${e.category}</${Pill}>`}</div>
          <div class="d">${e.date ? niceDate(e.date) : (e.when_bucket || "soon").replace(/_/g, " ")}${e.starts_at ? " · " + niceTime(e.starts_at) : (e.at_time ? " · " + e.at_time : "")}${(e.location || e.place) ? " · 📍 " + (e.location || e.place) : ""}</div>
        </div>
        <div class="rowactions">
          ${e.visibility === "public" && html`<button class="btn sm ghost" title="Copy the public invite link — anyone can view, join, and sign up from it"
            onClick=${() => { navigator.clipboard?.writeText(fnUrl("share", { e: e.id })); flash("Invite link copied 🔗"); }}>🔗</button>`}
          <a class="btn sm ghost" title="Download .ics — add to any calendar" href=${fnUrl("ics", { event: e.id })}>📅</a>
          <button class="btn sm ghost" onClick=${() => setRoster(e)}>RSVPs</button>
          <button class="btn sm ghost" onClick=${() => setEditing(e)}>Edit</button>
          <button class="btn sm danger" onClick=${() => remove(e)}>Delete</button>
        </div>
      </div>`)}
      ${error ? html`<${LoadError} what="events" error=${error} onRetry=${reload} />`
        : events === null ? html`<${Loading} />`
        : events.length === 0 && html`<${Empty}>${showPast ? "No past events." : "Nothing coming up — plan something 🎉"}</${Empty}>`}
    </div>
    ${editing && html`<${EventModal} client=${client} community=${community} session=${session}
      event=${editing.id ? editing : null} flash=${flash}
      onClose=${() => setEditing(null)} onSaved=${() => { setEditing(null); reload(); }} />`}
    ${roster && html`<${RosterModal} client=${client} event=${roster} flash=${flash} onClose=${() => setRoster(null)} />`}
  </${Page}>`;
}

function EventModal({ client, community, session, event, flash, onClose, onSaved }) {
  const [f, setF] = useState({
    title: event?.title || "", date: event?.date || todayStr(), starts_at: event?.starts_at || "",
    location: event?.location || event?.place || "", price: event ? (event.price_cents / 100 || "") : "",
    category: event?.category || "other", note: event?.note || "",
    capacity: event?.capacity || "", link: event?.link || "",
  });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      let image_path = event?.image_path || null;
      if (file) image_path = await uploadMedia(client, "ev", file);
      const location = f.location.trim() || null;
      const row = {
        community_id: community.id, host_id: event?.host_id || session.user.id,
        title: f.title.trim(), date: f.date || null, starts_at: f.starts_at || null, location,
        image_path, price_cents: toCents(f.price),
        // full parity with the app's Plan-something sheet
        category: f.category, note: f.note.trim() || null,
        capacity: f.capacity ? String(f.capacity) : null, link: f.link.trim() || null,
        visibility: "public",
        city: community.city || DEFAULT_CITY,
        // the mobile app renders when_bucket / at_time / place — one helper writes them everywhere
        ...eventMirror({ date: f.date, starts_at: f.starts_at, location }),
      };
      const q = event ? client.from("activities").update(row).eq("id", event.id) : client.from("activities").insert(row);
      const { error } = await q;
      if (error) throw error;
      flash(event ? "Event updated" : "Event created — it's live in the app ✨");
      onSaved();
    } catch (err) { showError(flash, "Save event", err); }
    setBusy(false);
  };

  return html`<${Modal} title=${event ? "Edit event" : "New event"} onClose=${onClose}>
    <form onSubmit=${save}>
      <div class="field"><label>Title</label><input required value=${f.title} onInput=${set("title")} placeholder="Eagle Rock Hike" /></div>
      <div class="field"><label>Category</label>
        <div class="u-row u-wrap" style="gap:6px">
          ${EVENT_CATEGORIES.map((c) => html`<button type="button" class="chip" aria-pressed=${f.category === c.key ? "true" : "false"}
            onClick=${() => setF({ ...f, category: c.key })}>${c.label}</button>`)}
        </div></div>
      <div class="fieldrow">
        <div class="field"><label>Date</label><input type="date" required value=${f.date} onInput=${set("date")} /></div>
        <div class="field"><label>Start time</label><input type="time" value=${f.starts_at} onInput=${set("starts_at")} /></div>
        <div class="field"><label>Price (optional)</label><input type="number" min="0" step="0.01" value=${f.price} onInput=${set("price")} placeholder="0" /></div>
      </div>
      <div class="field"><label>Location name</label><input value=${f.location} onInput=${set("location")} placeholder="Eagle Rock Trailhead" /></div>
      <div class="field"><label>Note</label><input value=${f.note} onInput=${set("note")} placeholder="Bring layers — it gets windy" /></div>
      <div class="fieldrow">
        <div class="field"><label>Capacity (optional)</label><input type="number" min="1" value=${f.capacity} onInput=${set("capacity")} placeholder="∞" /></div>
        <div class="field"><label>Link</label><input value=${f.link} onInput=${set("link")} placeholder="https://…" /></div>
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
  const { data: rows, error, reload } = useLoader(() => client.from("rsvps")
    .select("status, created_at, profile:profiles!rsvps_profile_id_fkey(id,display_name,avatar_url)")
    .eq("activity_id", event.id).order("created_at"), [client, event.id], { flash, where: "RSVPs" });

  const kick = async (r) => {
    if (!confirmDanger(`Remove ${r.profile?.display_name || "this member"} from "${event.title}"?`)) return;
    const { error: e } = await client.from("rsvps").delete().eq("activity_id", event.id).eq("profile_id", r.profile.id);
    if (e) showError(flash, "Remove RSVP", e); else { flash("Removed"); reload(); }
  };

  return html`<${Modal} title=${`RSVPs — ${event.title}`} onClose=${onClose}>
    <table class="table"><thead><tr><th></th><th>Member</th><th>Status</th><th></th></tr></thead><tbody>
      ${(rows || []).map((r) => html`<tr>
        <td style="width:36px"><${Avatar} profile=${r.profile} size="sm" /></td>
        <td>${r.profile?.display_name || "—"}</td>
        <td><${Pill}>${r.status}</${Pill}></td>
        <td class="actions"><button class="btn sm danger" onClick=${() => kick(r)}>Remove</button></td>
      </tr>`)}
    </tbody></table>
    ${error ? html`<${LoadError} what="RSVPs" error=${error} onRetry=${reload} />` : rows === null ? html`<${Loading} />` : rows.length === 0 && html`<${Empty} mt>No RSVPs yet.</${Empty}>`}
  </${Modal}>`;
}
