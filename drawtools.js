import { useState, useEffect, useRef, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { html } from "./ui.js?v=33";

/* Map ink — vector drawing on top of the city map artwork.
   Elements live in a 0–1000 normalized space (viewBox stretched over the
   map image), so drawings stay glued to the art at any size, console or
   phone. Strokes use vector-effect:non-scaling-stroke so line weight reads
   the same everywhere. Saved per city to map_drawings: `elements` (source,
   for re-editing) + `svg` (compiled overlay the app renders verbatim). */

const COLORS = ["#241d1a", "#e85d75", "#18857a", "#f0a830", "#3b6fb6", "#ffffff"];
const TOOLS = [
  ["pencil", "✏️", "Pencil — thin freehand"],
  ["brush", "🖌️", "Brush — thick soft stroke"],
  ["line", "╱", "Line"],
  ["arrow", "➜", "Arrow"],
  ["rect", "▭", "Rectangle"],
  ["ellipse", "◯", "Ellipse"],
  ["text", "T", "Text — click the map, then type"],
  ["eraser", "🧽", "Eraser — click or drag over a mark to remove it"],
];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* quadratic midpoint smoothing for freehand points */
const smoothPath = (pts) => {
  if (pts.length < 3) return "M" + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L");
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  return d;
};

/* one element → SVG markup (used for both live render and the compiled file) */
const elSvg = (e, i) => {
  const di = i != null ? ` data-di="${i}"` : "";
  const vec = ` vector-effect="non-scaling-stroke"`;
  if (e.t === "path")
    return `<path${di} d="${e.d}" fill="none" stroke="${e.c}" stroke-width="${e.w}" stroke-linecap="round" stroke-linejoin="round" opacity="${e.o ?? 1}"${vec}/>`;
  if (e.t === "line" || e.t === "arrow")
    return `<line${di} x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="${e.c}" stroke-width="${e.w}" stroke-linecap="round"${e.t === "arrow" ? ` marker-end="url(#ink-arr)"` : ""}${vec}/>`;
  if (e.t === "rect")
    return `<rect${di} x="${e.x}" y="${e.y}" width="${e.w2}" height="${e.h2}" fill="none" stroke="${e.c}" stroke-width="${e.w}" stroke-linejoin="round" rx="6"${vec}/>`;
  if (e.t === "ellipse")
    return `<ellipse${di} cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" fill="none" stroke="${e.c}" stroke-width="${e.w}"${vec}/>`;
  if (e.t === "text")
    return `<text${di} x="${e.x}" y="${e.y}" fill="${e.c}" font-family="Lacquer, cursive" font-size="${e.s}" paint-order="stroke" stroke="#fbf6f0" stroke-width="${Math.max(2, e.s / 8)}" stroke-linejoin="round">${esc(e.text)}</text>`;
  return "";
};

const DEFS = `<defs><marker id="ink-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="context-stroke"/></marker></defs>`;
export const compileSvg = (elements) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible">${DEFS}${elements.map((e) => elSvg(e)).join("")}</svg>`;

/* read-only overlay for saved ink (draw mode off, and reusable elsewhere) */
export function InkOverlay({ elements }) {
  if (!elements?.length) return null;
  return html`<div style="position:absolute;inset:0;pointer-events:none" dangerouslySetInnerHTML=${{ __html: compileSvg(elements) }}></div>`;
}

export function MapInk({ client, city, flash, onExit, saved, onSaved }) {
  const [els, setEls] = useState(saved || []);
  const [tool, setTool] = useState("pencil");
  const [color, setColor] = useState("#241d1a");
  const [size, setSize] = useState(4);
  const [draft, setDraftState] = useState(null);  // element being drawn
  const [textAt, setTextAt] = useState(null);     // {x,y} while typing
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const undoStack = useRef([]), redoStack = useRef([]);
  const svgRef = useRef(null);
  const pts = useRef([]);
  // pointer events can outrun re-renders (fast strokes), so handlers read refs
  const elsRef = useRef(els);
  const draftRef = useRef(null);
  const setElsBoth = (v) => { elsRef.current = v; setEls(v); };
  const setDraft = (v) => { draftRef.current = v; setDraftState(v); };

  useEffect(() => { setElsBoth(saved || []); setDirty(false); undoStack.current = []; redoStack.current = []; }, [city]);

  const commit = (el) => {
    undoStack.current.push(elsRef.current); redoStack.current = [];
    setElsBoth([...elsRef.current, el]); setDirty(true);
  };
  const removeAt = (idx) => {
    undoStack.current.push(elsRef.current); redoStack.current = [];
    setElsBoth(elsRef.current.filter((_, i) => i !== idx)); setDirty(true);
  };
  const undo = () => { if (!undoStack.current.length) return; redoStack.current.push(elsRef.current); setElsBoth(undoStack.current.pop()); setDirty(true); };
  const redo = () => { if (!redoStack.current.length) return; undoStack.current.push(elsRef.current); setElsBoth(redoStack.current.pop()); setDirty(true); };
  const clearAll = () => { if (!elsRef.current.length || !confirm("Clear every mark on this city's map?")) return; undoStack.current.push(elsRef.current); redoStack.current = []; setElsBoth([]); setDirty(true); };

  const norm = (ev) => {
    const r = svgRef.current.getBoundingClientRect();
    return [Math.max(0, Math.min(1000, ((ev.clientX - r.left) / r.width) * 1000)),
            Math.max(0, Math.min(1000, ((ev.clientY - r.top) / r.height) * 1000))];
  };

  const eraseAt = (ev) => {
    const t = document.elementFromPoint(ev.clientX, ev.clientY);
    const idx = t?.getAttribute?.("data-di");
    if (idx != null) removeAt(+idx);
  };

  const down = (ev) => {
    ev.stopPropagation(); ev.preventDefault();
    if (textAt) return;                                  // finish the text box first
    const [x, y] = norm(ev);
    if (tool === "eraser") { eraseAt(ev); return; }
    if (tool === "text") { setTextAt({ x, y }); return; }
    if (tool === "pencil" || tool === "brush") {
      pts.current = [[x, y]];
      setDraft({ t: "path", d: `M${x.toFixed(1)} ${y.toFixed(1)}`, c: color, w: tool === "brush" ? size * 2.5 : size, o: tool === "brush" ? 0.85 : 1 });
    } else if (tool === "line" || tool === "arrow") {
      setDraft({ t: tool, x1: x, y1: y, x2: x, y2: y, c: color, w: size });
    } else if (tool === "rect") {
      setDraft({ t: "rect", _x0: x, _y0: y, x, y, w2: 0, h2: 0, c: color, w: size });
    } else if (tool === "ellipse") {
      setDraft({ t: "ellipse", _x0: x, _y0: y, cx: x, cy: y, rx: 0, ry: 0, c: color, w: size });
    }
    ev.currentTarget.setPointerCapture?.(ev.pointerId);
  };
  const move = (ev) => {
    if (tool === "eraser" && ev.buttons) { eraseAt(ev); return; }
    const draft = draftRef.current;
    if (!draft) return;
    ev.stopPropagation();
    const [x, y] = norm(ev);
    if (draft.t === "path") {
      const last = pts.current[pts.current.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) < 2.5) return;
      pts.current.push([x, y]);
      setDraft({ ...draft, d: smoothPath(pts.current) });
    } else if (draft.t === "line" || draft.t === "arrow") {
      setDraft({ ...draft, x2: x, y2: y });
    } else if (draft.t === "rect") {
      setDraft({ ...draft, x: Math.min(draft._x0, x), y: Math.min(draft._y0, y), w2: Math.abs(x - draft._x0), h2: Math.abs(y - draft._y0) });
    } else if (draft.t === "ellipse") {
      setDraft({ ...draft, cx: (draft._x0 + x) / 2, cy: (draft._y0 + y) / 2, rx: Math.abs(x - draft._x0) / 2, ry: Math.abs(y - draft._y0) / 2 });
    }
  };
  const up = (ev) => {
    const draft = draftRef.current;
    if (!draft) return;
    ev.stopPropagation();
    const { _x0, _y0, ...el } = draft;
    const tooSmall = (el.t === "rect" && el.w2 < 4 && el.h2 < 4)
      || (el.t === "ellipse" && el.rx < 2 && el.ry < 2)
      || ((el.t === "line" || el.t === "arrow") && Math.hypot(el.x2 - el.x1, el.y2 - el.y1) < 3);
    if (!tooSmall) commit(el);
    setDraft(null); pts.current = [];
  };

  const commitText = (value) => {
    const text = value.trim();
    if (text) commit({ t: "text", x: textAt.x, y: textAt.y, s: Math.max(18, size * 7), c: color, text });
    setTextAt(null);
  };

  const save = async () => {
    setSaving(true);
    const { data: sess } = await client.auth.getSession();
    const { error } = await client.from("map_drawings").upsert({
      city, elements: els, svg: compileSvg(els),
      updated_at: new Date().toISOString(), updated_by: sess?.session?.user?.email || null,
    }, { onConflict: "city" });
    setSaving(false);
    if (error) flash(error.message);
    else { setDirty(false); flash("Map ink saved — live for members 🖋️"); onSaved?.(els); }
  };
  const exit = () => {
    if (dirty && !confirm("Leave drawing mode without saving? Unsaved marks are lost.")) return;
    onExit();
  };

  const liveSvg = DEFS + els.map((e, i) => elSvg(e, i)).join("") + (draft ? elSvg({ ...draft }) : "");
  const cursor = tool === "eraser" ? "cell" : tool === "text" ? "text" : "crosshair";

  return html`
    <div class="ink-layer" style=${`cursor:${cursor}`}>
      <svg ref=${svgRef} viewBox="0 0 1000 1000" preserveAspectRatio="none"
        style="position:absolute;inset:0;width:100%;height:100%;overflow:visible"
        onPointerDown=${down} onPointerMove=${move} onPointerUp=${up}
        dangerouslySetInnerHTML=${{ __html: liveSvg }}></svg>
      ${textAt && html`<input class="ink-textinput" autofocus placeholder="type, then Enter"
        style=${`left:${textAt.x / 10}%;top:${textAt.y / 10}%;color:${color};font-size:${Math.max(14, size * 3)}px`}
        onKeyDown=${(e) => { if (e.key === "Enter") commitText(e.target.value); if (e.key === "Escape") setTextAt(null); }}
        onBlur=${(e) => commitText(e.target.value)}
        ref=${(el2) => el2 && setTimeout(() => el2.focus(), 0)} />`}
    </div>
    <div class="ink-bar" onClick=${(e) => e.stopPropagation()} onPointerDown=${(e) => e.stopPropagation()}>
      ${TOOLS.map(([k, icon, tip]) => html`<button class=${"ink-tool" + (tool === k ? " on" : "")} title=${tip} onClick=${() => setTool(k)}>${icon}</button>`)}
      <span class="ink-sep"></span>
      ${COLORS.map((c) => html`<button class=${"ink-swatch" + (color === c ? " on" : "")} style=${`background:${c}`} title=${c} onClick=${() => setColor(c)}></button>`)}
      <input type="color" class="ink-custom" value=${color} title="Custom color" onInput=${(e) => setColor(e.target.value)} />
      <span class="ink-sep"></span>
      <input type="range" min="1" max="16" value=${size} title="Size" style="width:70px" onInput=${(e) => setSize(+e.target.value)} />
      <span class="ink-sep"></span>
      <button class="ink-tool" title="Undo" disabled=${!undoStack.current.length} onClick=${undo}>↩︎</button>
      <button class="ink-tool" title="Redo" disabled=${!redoStack.current.length} onClick=${redo}>↪︎</button>
      <button class="ink-tool" title="Clear all" onClick=${clearAll}>🗑</button>
      <span class="ink-sep"></span>
      <button class="btn small" disabled=${saving || !dirty} onClick=${save}>${saving ? "Saving…" : dirty ? "Save" : "Saved ✓"}</button>
      <button class="btn small ghost" onClick=${exit}>Done</button>
    </div>`;
}
