import { useState, useEffect, useRef, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Avatar, mediaUrl, uploadMedia, CITIES, cityName } from "./ui.js?v=26";

/* Up Next — the city journal, blog style. The CURRENT post is what members
   see under their Up next feed in the app; previous posts are the archive;
   drafts are invisible until published.

   Writing is an INLINE editor: a contenteditable surface styled with the
   exact .story-prose typography the reader sees — what you format is what
   ships. Storage stays the lightweight text format (blank-line paragraphs,
   ## heading, **bold**, *italic*, > quote); storyHtml() renders it and
   domToStory() reads the editor back into it, so console and app agree. */

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const storyHtml = (body) => esc(body || "").split(/\n{2,}/).map((b) => {
  b = b.trim();
  if (!b) return "";
  // image block: ![](public-url) on its own line — placed by drag & drop
  const im = b.match(/^!\[\]\((https?:\/\/[^\s)]+)\)$/);
  if (im) return `<figure class="story-img" contenteditable="false" draggable="true"><img src="${im[1]}" loading="lazy" /></figure>`;
  const inline = (t) => t
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  if (b.startsWith("## ")) return `<h3>${inline(b.slice(3))}</h3>`;
  if (b.startsWith("&gt; ")) return `<blockquote>${inline(b.slice(5).trim())}</blockquote>`;
  return `<p>${inline(b.replace(/\n/g, "<br/>"))}</p>`;
}).join("");

/* read the contenteditable back into the stored format */
const inlineText = (node) => {
  let s = "";
  node.childNodes.forEach((n) => {
    if (n.nodeType === 3) s += n.textContent;
    else if (n.nodeName === "B" || n.nodeName === "STRONG") s += `**${inlineText(n)}**`;
    else if (n.nodeName === "I" || n.nodeName === "EM") s += `*${inlineText(n)}*`;
    else if (n.nodeName === "BR") s += "\n";
    else if (n.nodeName === "A") s += n.getAttribute("href") || inlineText(n);
    else s += inlineText(n);
  });
  return s;
};
export const domToStory = (root) => {
  const blocks = [];
  root.childNodes.forEach((n) => {
    if (n.nodeType === 3) { const t = n.textContent.trim(); if (t) blocks.push(t); return; }
    if (n.nodeType !== 1) return;
    // a placed image (figure, or a bare img the browser dropped in)
    const img = n.nodeName === "IMG" ? n : (n.nodeName === "FIGURE" ? n.querySelector("img") : null);
    if (img) { const src = img.getAttribute("src"); if (src) blocks.push(`![](${src})`); return; }
    const t = inlineText(n).replace(/\u00a0/g, " ").trim();
    if (!t) return;
    if (/^H[1-4]$/.test(n.nodeName)) blocks.push("## " + t);
    else if (n.nodeName === "BLOCKQUOTE") blocks.push("> " + t);
    else blocks.push(t);
  });
  return blocks.join("\n\n");
};

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

  const pickCity = (c) => { localStorage.setItem("ca.storycity", c); setRows(null); setEditing(null); setCity(c); };

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
    if (error) flash(error.message); else { flash("Deleted"); if (editing?.id === s.id) setEditing(null); load(); }
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
      ${!editing && html`<button class="btn" onClick=${() => setEditing({})}>✍️ New post</button>`}
    </div>
    <div class="subnav" style="margin-bottom:16px">
      ${CITIES.map(([k, label]) => html`<button class=${city === k ? "on" : ""} onClick=${() => pickCity(k)}>${label}</button>`)}
    </div>

    ${editing && html`<${InlineEditor} key=${editing.id || "new"} client=${client} session=${session} city=${city} flash=${flash}
      story=${editing.id ? editing : null}
      onClose=${() => setEditing(null)} onSaved=${() => { setEditing(null); load(); }} />`}

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
  </div>`;
}

/* the writing surface: same typography as the published hero, formatted live */
function InlineEditor({ client, session, city, story, flash, onClose, onSaved }) {
  const [title, setTitle] = useState(story?.title || "");
  const [videoUrl, setVideoUrl] = useState(story?.video_url || "");
  const [images, setImages] = useState(story?.images || []);
  const [busy, setBusy] = useState(false);
  const prose = useRef(null);

  useEffect(() => {
    if (!prose.current) return;
    try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch {}
    prose.current.innerHTML = storyHtml(story?.body) || "<p><br/></p>";
    prose.current.focus();
  }, []);

  // toolbar acts on the live selection; mousedown-preventDefault keeps it
  const cmd = (fn) => (e) => { e.preventDefault(); fn(); prose.current?.focus(); };
  const block = (tag) => document.execCommand("formatBlock", false, tag);

  /* ---- drag & drop image placement ---- */
  const dragSrc = useRef(null);   // figure being repositioned (null when dragging from the tray)
  const mkFigure = (url) => {
    const fig = document.createElement("figure");
    fig.className = "story-img"; fig.contentEditable = "false"; fig.draggable = true;
    const img = document.createElement("img"); img.src = url; img.loading = "lazy";
    fig.appendChild(img);
    return fig;
  };
  // dragging a figure that's already in the article = repositioning
  const onDragStart = (e) => {
    const fig = e.target.closest?.(".story-img");
    if (!fig) return;
    dragSrc.current = fig;
    e.dataTransfer.setData("text/plain", "collide-img:" + fig.querySelector("img").src);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDrop = (e) => {
    const t = e.dataTransfer.getData("text/plain");
    if (!t.startsWith("collide-img:")) return;   // not ours — let the browser handle it
    e.preventDefault();
    const url = t.slice(12);
    let range = null;
    if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(e.clientX, e.clientY);
    else if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(e.clientX, e.clientY);
      if (p) { range = document.createRange(); range.setStart(p.offsetNode, p.offset); }
    }
    const fig = mkFigure(url);
    if (range) {
      // land between blocks, not inside one — hop up to the top-level block,
      // then place above or below it depending on which half was hit
      let node = range.startContainer;
      while (node.parentNode && node.parentNode !== prose.current) node = node.parentNode;
      if (node === prose.current || !node.parentNode) prose.current.appendChild(fig);
      else {
        const r = node.getBoundingClientRect?.();
        const before = r && e.clientY < r.top + r.height / 2;
        prose.current.insertBefore(fig, before ? node : node.nextSibling);
      }
    } else prose.current.appendChild(fig);
    if (dragSrc.current && dragSrc.current !== fig) dragSrc.current.remove();
    dragSrc.current = null;
  };

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
    if (!title.trim()) { flash("Give it a title"); return; }
    setBusy(true);
    const body = domToStory(prose.current);
    const row = {
      title: title.trim(), body: body || null,
      video_url: videoUrl.trim() || null, images, city,
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

  return html`<div class="card story-editor">
    <div class="story-kicker">${story ? "Editing" : "New post"} · ${cityName(city)}</div>
    <input class="story-edit-title" value=${title} onInput=${(e) => setTitle(e.target.value)}
      placeholder="The week ahead in ${cityName(city)}" />

    <div class="story-toolbar">
      <button title="Paragraph" onMouseDown=${cmd(() => block("p"))}>¶</button>
      <button title="Heading" onMouseDown=${cmd(() => block("h3"))} style="font-family:var(--display);font-weight:600">H</button>
      <button title="Bold" onMouseDown=${cmd(() => document.execCommand("bold"))}><b>B</b></button>
      <button title="Italic" onMouseDown=${cmd(() => document.execCommand("italic"))}><i>I</i></button>
      <button title="Pull quote" onMouseDown=${cmd(() => block("blockquote"))}>❝</button>
      <span class="tiny" style="color:var(--faint);margin-left:auto">formatted exactly as readers see it</span>
    </div>
    <div class="story-prose story-editarea" contenteditable="true" ref=${prose}
      onDragStart=${onDragStart} onDragOver=${(e) => e.preventDefault()} onDrop=${onDrop}
      onPaste=${(e) => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); }}></div>

    <div class="fieldrow" style="margin-top:14px">
      <div class="field" style="margin:0"><label>Video (YouTube / Vimeo — embedded in the app)</label>
        <input value=${videoUrl} onInput=${(e) => setVideoUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" /></div>
    </div>
    <div class="field" style="margin-top:12px"><label>Photos <span class="muted">(first one is the cover — drag any into the story to place it)</span></label>
      ${images.length > 0 && html`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        ${images.map((p, i) => html`<div style="position:relative" key=${p}>
          <img src=${mediaUrl(client, p)} alt="" draggable=${true} title="Drag into the story to place it"
            onDragStart=${(e) => { e.dataTransfer.setData("text/plain", "collide-img:" + mediaUrl(client, p)); e.dataTransfer.effectAllowed = "copy"; }}
            style=${"width:86px;height:60px;object-fit:cover;border-radius:8px;cursor:grab" + (i === 0 ? ";outline:2px solid var(--rose)" : "")} />
          <button type="button" title="Remove photo" onClick=${() => setImages(images.filter((x) => x !== p))}
            style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:none;background:#241d1a;color:#fff;font-size:11px;line-height:1;cursor:pointer">×</button>
        </div>`)}
      </div>`}
      <input type="file" accept="image/*" multiple onChange=${addImages} /></div>

    <div class="actions" style="justify-content:space-between;margin-top:14px">
      <button type="button" class="btn ghost" onClick=${onClose}>Cancel</button>
      <div style="display:flex;gap:10px">
        <button type="button" class="btn ghost" disabled=${busy} onClick=${() => save(story ? null : false)}>${busy ? "…" : "Save draft"}</button>
        <button type="button" class="btn" disabled=${busy} onClick=${() => save(true)}>${busy ? "…" : "Publish"}</button>
      </div>
    </div>
  </div>`;
}
