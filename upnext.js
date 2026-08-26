import { useState, useEffect, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Avatar, Modal, mediaUrl, uploadMedia, CITIES, cityName } from "./ui.js?v=17";

/* Up Next — the city leader's journal. Staff write editorial stories (text,
   images, an embedded video) into the app's Up next feed, per city. Drafts
   stay invisible to members until published. MVP: plain text (blank line =
   paragraph), images[] with the first as cover, one video URL. */

const ago = (iso) => {
  if (!iso) return "";
  const d = Math.floor((Date.now() - new Date(iso)) / 864e5);
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d}d ago`;
};

export function UpNextPage({ client, session, flash }) {
  const [city, setCity] = useState(localStorage.getItem("ca.storycity") || "nyc");
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);   // null | {} (new) | story row

  const pickCity = (c) => { localStorage.setItem("ca.storycity", c); setRows(null); setCity(c); };

  const load = useCallback(async () => {
    const { data, error } = await client.from("stories")
      .select("*, author:profiles!stories_author_id_fkey(id,display_name,avatar_url)")
      .eq("city", city).order("created_at", { ascending: false }).limit(200);
    if (error) flash(error.message);
    setRows(data || []);
  }, [client, city]);
  useEffect(() => { load(); }, [load]);

  const setPublished = async (s, published) => {
    const { error } = await client.from("stories").update({
      published, published_at: published ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("id", s.id);
    if (error) flash(error.message);
    else { flash(published ? "Published — it's live in Up next ✨" : "Unpublished — back to draft"); load(); }
  };
  const remove = async (s) => {
    if (!confirm(`Delete "${s.title}"? Members will see it disappear from Up next.`)) return;
    const { error } = await client.from("stories").delete().eq("id", s.id);
    if (error) flash(error.message); else { flash("Deleted"); load(); }
  };

  const live = (rows || []).filter((r) => r.published).length;

  return html`<div class="page" style="max-width:860px">
    <div class="pagehead">
      <h2>Up Next <span class="muted" style="font:400 13px var(--body)">the city journal — stories members see in their Up next feed</span></h2>
      <button class="btn" onClick=${() => setEditing({})}>+ New story</button>
    </div>
    <div class="subnav" style="margin-bottom:14px">
      ${CITIES.map(([k, label]) => html`<button class=${city === k ? "on" : ""} onClick=${() => pickCity(k)}>${label}</button>`)}
    </div>
    ${rows !== null && html`<p class="tiny muted" style="margin:0 0 12px">${live} live · ${(rows || []).length - live} draft${(rows || []).length - live === 1 ? "" : "s"} in ${cityName(city)}</p>`}

    ${rows === null ? html`<div class="empty" style="border:0">Loading…</div>`
      : rows.length === 0 ? html`<div class="empty">No stories for ${cityName(city)} yet — write the first one ✍️</div>`
      : rows.map((s) => html`<div class="card story-row" key=${s.id}>
        ${s.images?.[0]
          ? html`<img class="story-cover" src=${mediaUrl(client, s.images[0])} alt="" />`
          : html`<div class="story-cover ph">${s.video_url ? "🎬" : "📰"}</div>`}
        <div style="flex:1;min-width:0">
          <div class="story-title">${s.title}
            <span class=${"pillstat " + (s.published ? "member" : "pending")}>${s.published ? "live" : "draft"}</span>
          </div>
          <div class="story-meta">
            ${s.author && html`<${Avatar} profile=${s.author} size="sm" /> ${s.author.display_name || "—"} · `}
            ${s.published ? `published ${ago(s.published_at)}` : `drafted ${ago(s.created_at)}`}
            ${s.images?.length > 0 && html` · ${s.images.length} photo${s.images.length === 1 ? "" : "s"}`}
            ${s.video_url && html` · 🎬 video`}
          </div>
          ${s.body && html`<div class="story-excerpt">${s.body.slice(0, 160)}${s.body.length > 160 ? "…" : ""}</div>`}
        </div>
        <div class="rowactions" style="flex:none">
          <button class="btn small ghost" onClick=${() => setEditing(s)}>Edit</button>
          <button class="btn small ${s.published ? "ghost" : ""}" onClick=${() => setPublished(s, !s.published)}>${s.published ? "Unpublish" : "Publish"}</button>
          <button class="btn small danger" onClick=${() => remove(s)}>Delete</button>
        </div>
      </div>`)}

    ${editing && html`<${StoryModal} client=${client} session=${session} city=${city} flash=${flash}
      story=${editing.id ? editing : null}
      onClose=${() => setEditing(null)} onSaved=${() => { setEditing(null); load(); }} />`}
  </div>`;
}

function StoryModal({ client, session, city, story, flash, onClose, onSaved }) {
  const [f, setF] = useState({
    title: story?.title || "",
    body: story?.body || "",
    video_url: story?.video_url || "",
  });
  const [images, setImages] = useState(story?.images || []);   // saved storage paths
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const addImages = async (e) => {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    setBusy(true);
    try {
      const paths = [];
      for (const file of files) paths.push(await uploadMedia(client, "story", file));
      setImages((im) => [...im, ...paths]);
      flash(`${paths.length} photo${paths.length === 1 ? "" : "s"} added`);
    } catch (err) { flash(err.message || String(err)); }
    setBusy(false);
    e.target.value = "";
  };

  const save = async (publish) => {
    if (!f.title.trim()) { flash("Give it a title"); return; }
    setBusy(true);
    const row = {
      title: f.title.trim(), body: f.body.trim() || null,
      video_url: f.video_url.trim() || null, images, city,
      updated_at: new Date().toISOString(),
      ...(publish != null ? { published: publish, published_at: publish ? new Date().toISOString() : null } : {}),
    };
    const q = story
      ? client.from("stories").update(row).eq("id", story.id)
      : client.from("stories").insert({ ...row, author_id: session.user.id,
          published: !!publish, published_at: publish ? new Date().toISOString() : null });
    const { error } = await q;
    setBusy(false);
    if (error) { flash(error.message); return; }
    flash(publish ? "Published — it's live in Up next ✨" : "Draft saved");
    onSaved();
  };

  return html`<${Modal} title=${story ? "Edit story" : `New story — ${cityName(city)}`} onClose=${onClose}>
    <div class="field"><label>Title</label>
      <input required value=${f.title} onInput=${set("title")} placeholder="The week ahead in ${cityName(city)}" /></div>
    <div class="field"><label>Story</label>
      <textarea rows="8" value=${f.body} onInput=${set("body")}
        placeholder="Write like a letter to the city. Blank line starts a new paragraph."></textarea></div>
    <div class="field"><label>Video (YouTube / Vimeo link — embedded in the app)</label>
      <input value=${f.video_url} onInput=${set("video_url")} placeholder="https://youtube.com/watch?v=…" /></div>
    <div class="field"><label>Photos <span class="muted">(first one is the cover)</span></label>
      ${images.length > 0 && html`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        ${images.map((p, i) => html`<div style="position:relative" key=${p}>
          <img src=${mediaUrl(client, p)} alt="" style=${"width:86px;height:60px;object-fit:cover;border-radius:8px" + (i === 0 ? ";outline:2px solid var(--rose)" : "")} />
          <button type="button" title="Remove photo" onClick=${() => setImages(images.filter((x) => x !== p))}
            style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:none;background:#241d1a;color:#fff;font-size:11px;line-height:1;cursor:pointer">×</button>
        </div>`)}
      </div>`}
      <input type="file" accept="image/*" multiple onChange=${addImages} /></div>
    <div class="actions" style="justify-content:space-between">
      <button type="button" class="btn ghost" onClick=${onClose}>Cancel</button>
      <div style="display:flex;gap:10px">
        <button type="button" class="btn ghost" disabled=${busy} onClick=${() => save(story ? null : false)}>${busy ? "…" : "Save draft"}</button>
        <button type="button" class="btn" disabled=${busy} onClick=${() => save(true)}>${busy ? "…" : "Publish"}</button>
      </div>
    </div>
  </${Modal}>`;
}
