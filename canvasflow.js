import { useState, useEffect, useRef, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { html } from "./ui.js?v=37";

/* Canvas — a Figma-style flow editor for the onboarding journeys.
   Mini phone screens laid left→right per flow with connectors, on a
   pan/zoom canvas. Click any text to edit it in place; drag a screen by
   its title bar; ⌘Z/⌘⇧Z undo/redo; Save snapshots a version (history
   drawer restores any of them). Document lives in canvas_docs (staff RLS),
   versions in canvas_versions. */

const FLOW_COLORS = { "Website sign-up": "#18857a", "Event invite": "#e85d75", "Add to circle": "#f0a830" };
const PHONE_W = 210, PHONE_H = 420;

const ago = (iso) => {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

/* An editable text node. Preact won't reconcile text INSIDE a
   contentEditable, so we write it to the DOM ourselves via a ref effect —
   only when the node isn't focused — so undo/redo/restore always show. */
function Editable({ text, cls, onEdit, onCommit }) {
  // ref callback runs every render (fresh identity); write text to the DOM
  // whenever the node isn't being edited — the reliable contentEditable sync.
  const sync = (n) => { if (n && document.activeElement !== n && n.innerText !== text) n.innerText = text; };
  return html`<span ref=${sync} class=${cls} contentEditable spellcheck="false"
    onFocus=${onEdit}
    onBlur=${(e) => onCommit(e.currentTarget.innerText)}
    onKeyDown=${(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}></span>`;
}

/* one element inside a phone */
function El({ el, onEdit, onCommit, bound }) {
  const cls = "cve cve-" + el.t + (bound ? " cve-bound" : "");
  if (el.t === "pills") {
    return html`<div class=${"cve cve-pillswrap"}>
      <span class="cve-pillrow">${el.text.split("|").map((p, i) => html`<span key=${i} class="cve-chip">${p.trim()}</span>`)}</span>
      <${Editable} text=${el.text} cls="cve-pilledit" onEdit=${onEdit} onCommit=${onCommit} /></div>`;
  }
  if (el.t === "avatars") {
    return html`<div class=${cls}>
      <span class="cve-avrow">${[0, 1, 2].map((i) => html`<span key=${i} class="cve-av" style=${`background:${["#e85d75", "#18857a", "#f0a830"][i]}`}></span>`)}</span>
      <${Editable} text=${el.text} cls="" onEdit=${onEdit} onCommit=${onCommit} /></div>`;
  }
  if (el.t === "toggle") {
    return html`<div class=${cls}><span class="cve-check">✓</span><${Editable} text=${el.text} cls="" onEdit=${onEdit} onCommit=${onCommit} /></div>`;
  }
  return html`<${Editable} text=${el.text} cls=${cls} onEdit=${onEdit} onCommit=${onCommit} />`;
}

export function CanvasPage({ client, session, flash }) {
  const [doc, setDocState] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState(null);   // null = drawer closed
  const [view, setView] = useState({ x: 20, y: 20, z: 0.85 });
  const [copy, setCopy] = useState({});   // onboarding_copy: live text keyed, the CMS layer
  const copyRef = useRef({});
  const docRef = useRef(null);
  const viewRef = useRef(view);
  const undoStack = useRef([]), redoStack = useRef([]);
  const wrap = useRef(null);
  const editingRef = useRef(false);
  viewRef.current = view;

  const setDoc = (d) => { docRef.current = d; setDocState(d); };
  const snapshot = () => { undoStack.current.push(JSON.stringify(docRef.current)); redoStack.current = []; if (undoStack.current.length > 80) undoStack.current.shift(); setDirty(true); };
  const undo = useCallback(() => { if (!undoStack.current.length || document.activeElement?.isContentEditable) return; redoStack.current.push(JSON.stringify(docRef.current)); setDoc(JSON.parse(undoStack.current.pop())); setDirty(true); }, []);
  const redo = useCallback(() => { if (!redoStack.current.length || document.activeElement?.isContentEditable) return; undoStack.current.push(JSON.stringify(docRef.current)); setDoc(JSON.parse(redoStack.current.pop())); setDirty(true); }, []);

  useEffect(() => {
    client.from("canvas_docs").select("doc").eq("id", "onboarding").single()
      .then(({ data, error }) => { if (error) flash(error.message); else setDoc(data.doc); });
    client.from("onboarding_copy").select("key,text")
      .then(({ data }) => { const m = Object.fromEntries((data || []).map((r) => [r.key, r.text])); copyRef.current = m; setCopy(m); });
  }, [client]);

  // write a live-bound string straight to the CMS — users see it immediately
  const writeCopy = async (key, text) => {
    const next = { ...copyRef.current, [key]: text };
    copyRef.current = next; setCopy(next);
    const by = session?.user?.email || null;
    const { error } = await client.from("onboarding_copy").upsert({ key, text, updated_at: new Date().toISOString(), updated_by: by }, { onConflict: "key" });
    if (error) flash(error.message); else flash("Live — users see this now ✨");
  };

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  /* ---- pan (background drag) + zoom (wheel, toward cursor) ---- */
  const panRef = useRef(null);
  const bgDown = (e) => {
    if (e.target.closest(".cv-phone") || e.target.closest(".cv-topbar") || e.target.closest(".cv-drawer")) return;
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y };
    const move = (ev) => { const p = panRef.current; setView({ ...viewRef.current, x: p.ox + ev.clientX - p.sx, y: p.oy + ev.clientY - p.sy }); };
    const up = () => { panRef.current = null; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const onWheel = (e) => {
    e.preventDefault();
    const v = viewRef.current;
    const r = wrap.current.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const z = Math.min(2, Math.max(0.25, v.z * (e.deltaY < 0 ? 1.08 : 0.93)));
    // keep the point under the cursor fixed
    setView({ z, x: mx - ((mx - v.x) / v.z) * z, y: my - ((my - v.y) / v.z) * z });
  };
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [doc === null]);

  /* ---- drag a screen by its title bar ---- */
  const dragScreen = (s) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, sx: s.x, sy: s.y };
    let moved = false;
    const move = (ev) => {
      const z = viewRef.current.z;
      const nx = Math.round(start.sx + (ev.clientX - start.x) / z), ny = Math.round(start.sy + (ev.clientY - start.y) / z);
      if (!moved && Math.hypot(nx - start.sx, ny - start.sy) > 2) { moved = true; snapshot(); }
      if (!moved) return;
      setDoc({ ...docRef.current, screens: docRef.current.screens.map((q) => q.id === s.id ? { ...q, x: nx, y: ny } : q) });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  /* ---- text edits ---- */
  const commitText = (sid, idx) => (text) => {
    editingRef.current = false;
    const t = text.replace(/\n+/g, " ").trim();
    const s = docRef.current.screens.find((q) => q.id === sid);
    if (!s || s.els[idx]?.text === t) return;
    snapshot();
    const screens = docRef.current.screens.map((q) => q.id !== sid ? q : {
      ...q, els: t === "" ? q.els.filter((_, i) => i !== idx) : q.els.map((el, i) => i === idx ? { ...el, text: t } : el),
    });
    setDoc({ ...docRef.current, screens });
  };
  const commitTitle = (sid) => (e) => {
    editingRef.current = false;
    const t = e.currentTarget.innerText.replace(/\n/g, " ").trim() || "Untitled";
    const s = docRef.current.screens.find((q) => q.id === sid);
    if (s && s.title !== t) { snapshot(); setDoc({ ...docRef.current, screens: docRef.current.screens.map((q) => q.id === sid ? { ...q, title: t } : q) }); }
  };
  const addEl = (sid) => () => {
    snapshot();
    setDoc({ ...docRef.current, screens: docRef.current.screens.map((q) => q.id === sid ? { ...q, els: [...q.els, { t: "p", text: "New line — click to edit" }] } : q) });
  };
  const addScreen = (flow) => () => {
    snapshot();
    const inFlow = docRef.current.screens.filter((s) => s.flow === flow);
    const rightmost = inFlow.reduce((a, s) => Math.max(a, s.x), 0);
    const y = inFlow[0]?.y ?? 60;
    const id = "s" + Math.random().toString(36).slice(2, 8);
    setDoc({ ...docRef.current, screens: [...docRef.current.screens, { id, flow, x: rightmost + 260, y, title: "New screen", els: [{ t: "h", text: "Headline" }, { t: "p", text: "Click any text to edit it." }] }] });
  };
  const removeScreen = (sid) => () => {
    if (!confirm("Remove this screen from the canvas?")) return;
    snapshot();
    setDoc({ ...docRef.current, screens: docRef.current.screens.filter((q) => q.id !== sid) });
  };

  /* ---- save + versions ---- */
  const save = async () => {
    setSaving(true);
    const by = session?.user?.email || null;
    const { error } = await client.from("canvas_docs").update({ doc: docRef.current, updated_at: new Date().toISOString(), updated_by: by }).eq("id", "onboarding");
    if (!error) await client.from("canvas_versions").insert({ doc_id: "onboarding", doc: docRef.current, saved_by: by });
    setSaving(false);
    if (error) flash(error.message); else { setDirty(false); flash("Saved — version added to history ✓"); if (versions) openHistory(); }
  };
  const openHistory = async () => {
    const { data, error } = await client.from("canvas_versions").select("id,saved_at,saved_by,label").eq("doc_id", "onboarding").order("saved_at", { ascending: false }).limit(40);
    if (error) flash(error.message); else setVersions(data || []);
  };
  const restore = (vid) => async () => {
    const { data, error } = await client.from("canvas_versions").select("doc").eq("id", vid).single();
    if (error) return flash(error.message);
    snapshot();
    setDoc(data.doc);
    flash("Version restored to canvas — Save to keep it");
  };

  if (doc === null) return html`<div class="empty" style="border:0">Unrolling the canvas…</div>`;

  /* connectors: consecutive screens within a flow, ordered by x */
  const byFlow = {};
  for (const s of doc.screens) (byFlow[s.flow] = byFlow[s.flow] || []).push(s);
  const arrows = [];
  for (const flow of Object.keys(byFlow)) {
    const list = [...byFlow[flow]].sort((a, b) => a.x - b.x);
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      arrows.push({ flow, x1: a.x + PHONE_W, y1: a.y + PHONE_H / 2, x2: b.x, y2: b.y + PHONE_H / 2 });
    }
  }

  return html`<div class="cv-page">
    <div class="cv-topbar">
      <h2>Canvas <span class="muted" style="font:400 13px var(--body)">onboarding flows — click text to edit · drag screens · scroll to zoom</span></h2>
      <div class="cv-tools">
        ${Object.keys(FLOW_COLORS).map((f) => html`<button key=${f} class="btn small ghost" onClick=${addScreen(f)} title=${"Add a screen to " + f}
          style=${`border-color:${FLOW_COLORS[f]};color:${FLOW_COLORS[f]}`}>+ ${f.split(" ")[0]}</button>`)}
        <span class="ink-sep"></span>
        <button class="btn small ghost" onClick=${undo} title="Undo (⌘Z)">↩︎</button>
        <button class="btn small ghost" onClick=${redo} title="Redo (⌘⇧Z)">↪︎</button>
        <button class="btn small ghost" onClick=${() => setView({ x: 20, y: 20, z: 0.85 })}>Fit</button>
        <span class="ink-sep"></span>
        <button class="btn small ghost" onClick=${() => versions ? setVersions(null) : openHistory()}>🕘 History</button>
        <button class="btn small" disabled=${saving || !dirty} onClick=${save}>${saving ? "Saving…" : dirty ? "Save version" : "Saved ✓"}</button>
      </div>
    </div>

    <div class="cv-wrap" ref=${wrap} onPointerDown=${bgDown}>
      <div class="cv-world" style=${`transform:translate(${view.x}px,${view.y}px) scale(${view.z})`}>
        <svg class="cv-links" width="4000" height="2200">
          ${arrows.map((a, i) => html`<g key=${i}>
            <path d=${`M${a.x1} ${a.y1} C${a.x1 + 60} ${a.y1} ${a.x2 - 60} ${a.y2} ${a.x2 - 8} ${a.y2}`}
              fill="none" stroke=${FLOW_COLORS[a.flow] || "#8a7e75"} stroke-width="2" stroke-dasharray="1 6" stroke-linecap="round" />
            <circle cx=${a.x2 - 6} cy=${a.y2} r="3.5" fill=${FLOW_COLORS[a.flow] || "#8a7e75"} />
          </g>`)}
        </svg>
        ${Object.keys(byFlow).map((f) => {
          const first = [...byFlow[f]].sort((a, b) => a.x - b.x)[0];
          return html`<div key=${f} class="cv-flowlab" style=${`left:${first.x}px;top:${first.y - 34}px;color:${FLOW_COLORS[f] || "#8a7e75"}`}>${f}</div>`;
        })}
        ${doc.screens.map((s) => { const proposed = s.status === "proposed"; return html`<div key=${s.id} class=${"cv-phone" + (proposed ? " cv-proposed" : "")} style=${`left:${s.x}px;top:${s.y}px`}>
          <div class="cv-phead" onPointerDown=${dragScreen(s)} style=${`background:${FLOW_COLORS[s.flow] || "#8a7e75"}`}>
            <span key=${s.title} contentEditable spellcheck="false" onFocus=${() => { editingRef.current = true; }} onBlur=${commitTitle(s.id)}
              onKeyDown=${(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
              onPointerDown=${(e) => e.stopPropagation()}>${s.title}</span>
            <span class="cv-badge">${proposed ? "PROPOSED" : "LIVE"}</span>
            <button class="cv-x" onPointerDown=${(e) => e.stopPropagation()} onClick=${removeScreen(s.id)} title="Remove screen">×</button>
          </div>
          <div class="cv-screen">
            ${s.els.map((el, i) => {
              const bound = el.key && el.key in copy;
              const shownText = bound ? copy[el.key] : el.text;
              const onCommit = el.key
                ? (text) => { const t = text.replace(/\n+/g, " ").trim(); if (t && t !== (copyRef.current[el.key] ?? el.text)) writeCopy(el.key, t); }
                : commitText(s.id, i);
              return html`<${El} key=${s.id + ":" + i} el=${{ ...el, text: shownText }} bound=${bound}
                onEdit=${() => { editingRef.current = true; }} onCommit=${onCommit} />`;
            })}
            <button class="cv-addel" onClick=${addEl(s.id)}>+ text</button>
          </div>
        </div>`; })}
      </div>

      ${versions && html`<div class="cv-drawer">
        <div class="cv-dhead"><b>Version history</b><button class="linkbtn tiny" onClick=${() => setVersions(null)}>close</button></div>
        ${versions.length === 0 && html`<p class="tiny muted" style="padding:0 14px">No versions yet — hit Save to create the first one.</p>`}
        ${versions.map((v, i) => html`<div key=${v.id} class="cv-vrow">
          <div><b>${i === 0 ? "Latest save" : "Version"}</b><div class="tiny muted">${ago(v.saved_at)}${v.saved_by ? " · " + v.saved_by.split("@")[0] : ""}</div></div>
          <button class="btn small ghost" onClick=${restore(v.id)}>Restore</button>
        </div>`)}
      </div>`}
    </div>
  </div>`;
}
