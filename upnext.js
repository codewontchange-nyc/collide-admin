import { useState, useEffect, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Avatar, Modal, mediaUrl, uploadMedia, CITIES, cityName } from "./ui.js?v=18";

/* Up Next — the city journal, blog style. The CURRENT post is what members
   see under their Up next feed in the app; previous posts are the archive;
   drafts are invisible until published. Lightweight formatting: blank line =
   paragraph, ## heading, **bold**, *italic*, > quote, bare URLs become
   links. storyHtml() is the renderer — the app embeds the same rules. */

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const storyHtml = (body) => esc(body || "").split(/\n{2,}/).map((b) => {
  b = b.trim();
  if (!b) return "";
  const inline = (t) => t
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  if (b.startsWith("## ")) return `<h3>${inline(b.slice(3))}</h3>`;
  if (b.startsWith("&gt; ")) return `<blockquote>${inline(b.slice(5).trim())}</blockquote>`;
  return `<p>${inline(b.replace(/\n/g, "<br/>"))}</p>`;
}).join("");

const nice = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : "";
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
    else { flash(published ? "Published — it leads Up next now ✨" : "Unpublished — back to drafts"); load(); }
  };
  const remove = async (s) => {
    if (!confirm(`Delete "${s.title}"? Members will see it disappear from Up next.`)) return;
    const { error } = await client.from("stories").delete().eq("id", s.id);
    if (error) flash(error.message); else { flash("Deleted"); load(); }
  };

  const published = (rows || []).filter((r) => r.published)
    .sort((a, b) => (a.published_at < b.published_at ? 1 : -1));
  const current = published[0] || null;
  const previous = published.slice(1);
  const drafts = (rows || []).filter((r) => !r.published);

  const Actions = ({ s }) => html`<div class="rowactions" style="flex:none">
    <button class="btn small ghost" onClick=${() => setEditing(s)}>Edit</button>
    <button class="btn small ${s.published ? "ghost" : ""}" onClick=${() => setPublished(s, !s.published)}>${s.published ? "Unpublish" : "Publish"}</button>
    <button class="btn small danger" onClick=${() => remove(s)}>Delete</button>
  </div>`;

  return html`<div class="page" style="max-width:820px">
    <div class="pagehead">
      <h2>Up Next <span class="muted" style="font:400 13px var(--body)">the city journal — the current post leads members' Up next feed</span></h2>
      <button class="btn" onClick=${() => setEditing({})}>✍️ New post</button>
    </div>
    <div class="subnav" style="margin-bottom:16px">
      ${CITIES.map(([k, label]) => html`<button class=${city === k ? "on" : ""} onClick=${() => pickCity(k)}>${label}</button>`)}
    </div>

    ${rows === null ? html`<div class="empty" style="border:0">Loading…</div>` : html`
      <div class="section-label">Current post — live in ${cityName(city)}</div>
      ${current ? html`<div class="card story-hero">
        ${current.images?.[0] && html`<img class="story-hero-cover" src=${mediaUrl(client, current.images[0])} alt="" />`}
        <div class="story-hero-body">
          <div class="story-kicker">${cityName(city)} · ${nice(current.published_at)}</div>
          <h3 class="story-hero-title">${current.title}</h3>
          <div class="story-byline">
            ${current.author && html`<${Avatar} profile=${current.author} size="sm" /> <b>${current.author.display_name || "—"}</b>`}
            ${current.video_url && html`<span class="pillstat">🎬 video</span>`}
            ${current.images?.length > 1 && html`<span class="muted tiny">${current.images.length} photos</span>`}
          </div>
          <div class="story-prose" dangerouslySetInnerHTML=${{ __html: storyHtml(current.body) }}></div>
          ${current.images?.length > 1 && html`<div class="story-strip">
            ${current.images.slice(1).map((p) => html`<img src=${mediaUrl(client, p)} alt="" key=${p} />`)}
          </div>`}
          <div style="margin-top:12px"><${Actions} s=${current} /></div>
        </div>
      </div>` : html`<div class="empty" style="margin-bottom:18px">Nothing live in ${cityName(city)} — members see no editorial until you publish ✍️</div>`}

      ${drafts.length > 0 && html`<div class="section-label" style="margin-top:22px">Drafts</div>
        ${drafts.map((s) => html`<div class="card story-row" key=${s.id}>
          ${s.images?.[0] ? html`<img class="story-cover" src=${mediaUrl(client, s.images[0])} alt="" />` : html`<div class="story-cover ph">📝</div>`}
          <div style="flex:1;min-width:0">
            <div class="story-title">${s.title} <span class="pillstat pending">draft</span></div>
            <div class="story-meta">${s.author?.display_name || "—"} · drafted ${ago(s.created_at)}</div>
            ${s.body && html`<div class="story-excerpt">${s.body.slice(0, 120)}${s.body.length > 120 ? "…" : ""}</div>`}
          </div>
          <${Actions} s=${s} />
        </div>`)}`}

      <div class="section-label" style="margin-top:22px">Previous posts ${previous.length > 0 && html`<span class="muted">· ${previous.length}</span>`}</div>
      ${previous.length === 0 && html`<p class="tiny muted">No archive yet — when you publish a new post, the old one lands here (still readable in the app, just no longer leading).</p>`}
      ${previous.map((s) => html`<div class="card story-row" key=${s.id}>
        ${s.images?.[0] ? html`<img class="story-cover" src=${mediaUrl(client, s.images[0])} alt="" />` : html`<div class="story-cover ph">📰</div>`}
        <div style="flex:1;min-width:0">
          <div class="story-title">${s.title} <span class="pillstat member">was live</span></div>
          <div class="story-meta">${s.author?.display_name || "—"} · published ${nice(s.published_at)}</div>
          ${s.body && html`<div class="story-excerpt">${s.body.slice(0, 120)}${s.body.length > 120 ? "…" : ""}</div>`}
        </div>
        <${Actions} s=${s} />
      </div>`)}`}

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
  const [images, setImages] = useState(story?.images || []);
  const [tab, setTab] = useState("write");
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
    flash(publish ? "Published — it leads Up next now ✨" : "Draft saved");
    onSaved();
  };

  return html`<${Modal} title=${story ? "Edit post" : `New post — ${cityName(city)}`} onClose=${onClose}>
    <div class="field"><label>Title</label>
      <input required value=${f.title} onInput=${set("title")} placeholder="The week ahead in ${cityName(city)}" /></div>

    <div class="subnav" style="margin-bottom:10px">
      <button class=${tab === "write" ? "on" : ""} onClick=${() => setTab("write")}>Write</button>
      <button class=${tab === "preview" ? "on" : ""} onClick=${() => setTab("preview")}>Preview</button>
    </div>
    ${tab === "write"
      ? html`<div class="field">
          <textarea rows="11" value=${f.body} onInput=${set("body")}
            placeholder="Write like a letter to the city…"></textarea>
          <p class="tiny muted" style="margin:6px 0 0">Blank line = paragraph · <code>## Heading</code> · <code>**bold**</code> · <code>*italic*</code> · <code>${">"} quote</code> · bare URLs become links</p>
        </div>`
      : html`<div class="story-prose story-preview" dangerouslySetInnerHTML=${{ __html: storyHtml(f.body) || "<p><i>Nothing to preview yet…</i></p>" }}></div>`}

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
