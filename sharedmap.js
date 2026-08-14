import { useState, useEffect, useRef, useCallback, useMemo } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Modal } from "./ui.js";

/* The SAME map members see in the app: the hand-drawn artwork from map_config
   + map_events pins + community pins, all positioned by x/y fractions. Every
   edit here writes the same rows the app reads (and vice versa, realtime) —
   one universal map. Clouds & birds match the app's animations. */

const EMOJIS = ["📍", "🎉", "🎶", "🍕", "🍺", "🎨", "🏀", "🎬", "🌭", "☕", "🎪", "🕺"];
const VENUES = [
  { key: "", label: "📍 Just a pin" },
  { key: "stadium", label: "🏟️ Stadium" }, { key: "castle", label: "🏰 Castle" },
  { key: "mansion", label: "🏡 Mansion" }, { key: "museum", label: "🏛️ Museum" },
  { key: "theater", label: "🎭 Theater" },
];
const VENUE_EMOJI = { stadium: "🏟️", castle: "🏰", mansion: "🏡", museum: "🏛️", theater: "🎭" };
const CLOUD_PATH = "M24 62 C11 62 5 52 12 43 C6 33 18 26 28 32 C30 17 50 13 58 25 C65 11 89 13 90 31 C107 29 115 45 103 55 C109 64 96 67 88 63 C80 67 32 67 24 62 Z";
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const alive = (e) => !e.expires_at || new Date(e.expires_at).getTime() > Date.now();
const plus7d = () => new Date(Date.now() + 7 * 864e5).toISOString();

function Clouds() {
  const clouds = useMemo(() => Array.from({ length: 2 + Math.floor(Math.random() * 3) }, () => {
    const dur = rnd(85, 165);
    return { top: `${rnd(5, 74).toFixed(1)}%`, width: `${rnd(6, 20).toFixed(1)}%`,
      animationDuration: `${dur.toFixed(0)}s`, animationDelay: `-${rnd(0, dur).toFixed(0)}s`, opacity: rnd(0.68, 0.92).toFixed(2) };
  }), []);
  return html`<div class="map-clouds" aria-hidden="true">
    ${clouds.map((s, i) => html`<svg key=${i} class="map-cloud" style=${s} viewBox="0 0 120 74" fill="none">
      <path d=${CLOUD_PATH} fill="#fff" stroke="#111" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
    </svg>`)}
  </div>`;
}

function Birds() {
  const birds = useMemo(() => {
    const out = [];
    const flocks = 2 + Math.floor(Math.random() * 2);
    for (let f = 0; f < flocks; f++) {
      const n = Math.random() < 0.4 ? 1 : 3 + Math.floor(Math.random() * 3);
      const ltr = Math.random() < 0.5, dur = rnd(38, 72), delay = -rnd(0, dur);
      const yy = rnd(6, 70), drift = rnd(-14, 14), sz = rnd(1.1, 1.9), dx = ltr ? 112 : -112;
      for (let i = 0; i < n; i++) {
        const off = i * sz * 0.9 * (ltr ? -1 : 1);
        const vy = i === 0 ? 0 : (i % 2 ? -1 : 1) * Math.ceil(i / 2) * sz * 0.55;
        const x0 = (ltr ? -6 : 106) + off;
        out.push({ "--bx0": `${x0.toFixed(1)}%`, "--bx1": `${(x0 + dx).toFixed(1)}%`,
          "--by0": `${(yy + vy).toFixed(1)}%`, "--by1": `${(yy + vy + drift).toFixed(1)}%`,
          "--dur": `${dur.toFixed(0)}s`, "--delay": `${delay.toFixed(1)}s`,
          "--flap": `${rnd(0.5, 0.85).toFixed(2)}s`, "--flapd": `-${rnd(0, 0.8).toFixed(2)}s`,
          width: `${sz.toFixed(2)}%` });
      }
    }
    return out;
  }, []);
  return html`<div class="map-birds" aria-hidden="true">
    ${birds.map((s, i) => html`<svg key=${i} class="map-bird" style=${s} viewBox="0 0 26 14">
      <path class="w1" d="M2 10 Q8 2 13 8 Q18 2 24 10" />
      <path class="w2" d="M2 6 Q8 10 13 7 Q18 10 24 6" />
    </svg>`)}
  </div>`;
}

const mapImageUrl = (client, path) => {
  if (!path) return null;
  try { return client.storage.from("map").getPublicUrl(path).data.publicUrl; } catch { return null; }
};

export function SharedMap({ client, session, flash, readonly = false, compact = false }) {
  const [cfg, setCfg] = useState(undefined);
  const [events, setEvents] = useState([]);
  const [comms, setComms] = useState([]);
  const [editing, setEditing] = useState(null);   // {x,y} for new | event row for edit
  const wrap = useRef(null);
  const drag = useRef(null);

  const load = useCallback(async () => {
    const [c, e, k] = await Promise.all([
      client.from("map_config").select("*").eq("id", 1).maybeSingle(),
      client.from("map_events").select("*").order("created_at"),
      client.from("communities").select("id,name,emoji,x,y"),
    ]);
    setCfg(c.data || null);
    setEvents((e.data || []).filter(alive));
    setComms((k.data || []).filter((r) => r.x != null && r.y != null));
  }, [client]);
  useEffect(() => { load(); }, [load]);

  /* realtime: app edits appear here live, and vice versa */
  useEffect(() => {
    const ch = client.channel("ca-map-" + Math.random().toString(36).slice(2, 6))
      .on("postgres_changes", { event: "*", schema: "public", table: "map_events" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "map_config" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "communities" }, load)
      .subscribe();
    return () => { try { client.removeChannel(ch); } catch {} };
  }, [client, load]);

  const frac = (ev) => {
    const r = wrap.current.getBoundingClientRect();
    return { x: clamp01((ev.clientX - r.left) / r.width), y: clamp01((ev.clientY - r.top) / r.height) };
  };

  const onMapClick = (ev) => {
    if (readonly || drag.current?.moved) { drag.current = null; return; }
    if (ev.target.closest(".map-pin")) return;
    setEditing({ ...frac(ev), _new: true });
  };

  /* drag pins (events + communities) — pointer events, save on release */
  const startDrag = (row, table) => (ev) => {
    if (readonly) return;
    ev.stopPropagation(); ev.preventDefault();
    drag.current = { row, table, moved: false };
    const move = (e) => {
      const f = frac(e);
      drag.current.moved = true;
      drag.current.f = f;
      const el = ev.currentTarget;
      el.style.left = f.x * 100 + "%"; el.style.top = f.y * 100 + "%";
    };
    const up = async () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const d = drag.current;
      if (d?.moved && d.f) {
        const { error } = await client.from(d.table).update({ x: d.f.x, y: d.f.y }).eq("id", d.row.id);
        if (error) flash(error.message); else flash("Moved 📍");
        load();
      } else if (d && !d.moved && d.table === "map_events") {
        setEditing(d.row);   // plain click on an event pin = edit it
      }
      setTimeout(() => { drag.current = null; }, 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const uploadArt = async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `bg-${Date.now()}.${ext}`;
      const { error } = await client.storage.from("map").upload(path, file, { contentType: file.type || "image/jpeg", upsert: true });
      if (error) throw error;
      const { error: e2 } = await client.from("map_config").update({ image_path: path, updated_at: new Date().toISOString() }).eq("id", 1);
      if (e2) throw e2;
      flash("Map artwork updated 🗺️");
      load();
    } catch (e) { flash(e.message || String(e)); }
  };

  const img = cfg === undefined ? undefined : mapImageUrl(client, cfg?.image_path);

  return html`<div>
    ${!compact && html`<div class="pagehead">
      <h2 style="margin:0">Map <span class="muted" style="font:400 13px Inter">the same map members see — edits are live in the app</span></h2>
      ${!readonly && html`<label class="btn ghost" style="cursor:pointer">Replace artwork<input type="file" accept="image/*" style="display:none" onChange=${uploadArt} /></label>`}
    </div>`}
    ${img === undefined ? html`<div class="empty">Loading map…</div>`
      : !img ? html`<div class="empty">No map artwork yet — upload one 🗺️</div>`
      : html`<div class=${"smap" + (compact ? " compact" : "")} ref=${wrap} onClick=${onMapClick}>
          <img class="smap-img" src=${img} alt="Community map" draggable=${false} />
          <${Clouds} />
          <${Birds} />
          ${comms.map((c) => html`<button key=${"c" + c.id} class="map-pin community-pin" title=${c.name}
              style=${`left:${c.x * 100}%;top:${c.y * 100}%`} onPointerDown=${startDrag(c, "communities")}>
            <span class="pe">${c.emoji || "🏘️"}</span><span class="pl">${c.name}</span>
          </button>`)}
          ${events.map((e) => html`<button key=${e.id} class="map-pin" title=${e.title || ""}
              style=${`left:${e.x * 100}%;top:${e.y * 100}%`} onPointerDown=${startDrag(e, "map_events")}>
            <span class="pe">${e.venue ? VENUE_EMOJI[e.venue] : (e.emoji || "🎉")}</span>
            ${e.title && html`<span class="pl">${e.title}</span>`}
          </button>`)}
        </div>`}
    ${!compact && html`<p class="tiny muted" style="margin-top:10px">Click anywhere to drop an event pin · drag pins to move them · click a pin to edit. Community homes are placed from the app (or drag them here).</p>`}
    ${editing && html`<${PinModal} client=${client} session=${session} pin=${editing} flash=${flash}
      onClose=${() => setEditing(null)} onSaved=${() => { setEditing(null); load(); }} />`}
  </div>`;
}

function PinModal({ client, session, pin, flash, onClose, onSaved }) {
  const isNew = !!pin._new;
  const [f, setF] = useState({
    emoji: pin.emoji || "🎉", title: pin.title || "", at_time: pin.at_time || "",
    place: pin.place || "", note: pin.note || "", link: pin.link || "", venue: pin.venue || "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (isNew) {
        const { error } = await client.from("map_events").insert({
          ...f, x: pin.x, y: pin.y, expires_at: plus7d(), created_by: session.user.id,
        });
        if (error) throw error;
        flash("Pin dropped — live in the app 🎉");
      } else {
        const { error } = await client.from("map_events").update(f).eq("id", pin.id);
        if (error) throw error;
        flash("Pin updated");
      }
      onSaved();
    } catch (err) { flash(err.message || String(err)); }
    setBusy(false);
  };
  const renew = async () => {
    const { error } = await client.from("map_events").update({ expires_at: plus7d() }).eq("id", pin.id);
    if (error) flash(error.message); else { flash("Renewed for 7 days"); onSaved(); }
  };
  const remove = async () => {
    if (!confirm("Remove this pin from the map?")) return;
    const { error } = await client.from("map_events").delete().eq("id", pin.id);
    if (error) flash(error.message); else { flash("Pin removed"); onSaved(); }
  };

  return html`<${Modal} title=${isNew ? "Drop a pin" : "Edit pin"} onClose=${onClose}>
    <form onSubmit=${save}>
      <div class="field"><label>Pin emoji</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          ${EMOJIS.map((em) => html`<button type="button" class=${"btn small ghost" + (f.emoji === em ? " on-emoji" : "")}
            style=${f.emoji === em ? "border-color:#17181a" : ""} onClick=${() => setF({ ...f, emoji: em })}>${em}</button>`)}
          <input style="width:64px;padding:7px;border:1px solid var(--line);border-radius:8px;text-align:center" maxlength="2"
            value=${f.emoji} onInput=${set("emoji")} aria-label="Custom emoji" />
        </div></div>
      <div class="field"><label>Big event? Give it a landmark</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${VENUES.map((v) => html`<button type="button" class="btn small ghost" style=${f.venue === v.key ? "border-color:#17181a;font-weight:700" : ""}
            onClick=${() => setF({ ...f, venue: v.key })}>${v.label}</button>`)}
        </div></div>
      <div class="field"><label>Title</label><input value=${f.title} onInput=${set("title")} placeholder="Rooftop DJ set" /></div>
      <div class="fieldrow">
        <div class="field"><label>When</label><input value=${f.at_time} onInput=${set("at_time")} placeholder="Fri 9pm" /></div>
        <div class="field"><label>Place</label><input value=${f.place} onInput=${set("place")} placeholder="The Loft" /></div>
      </div>
      <div class="field"><label>Note</label><input value=${f.note} onInput=${set("note")} placeholder="Bring friends!" /></div>
      <div class="field"><label>Link</label><input value=${f.link} onInput=${set("link")} placeholder="https://…" /></div>
      <div class="actions" style="justify-content:space-between">
        <div style="display:flex;gap:8px">
          ${!isNew && html`<button type="button" class="btn small ghost" onClick=${renew}>Renew 7d</button>
            <button type="button" class="btn small danger" onClick=${remove}>Remove</button>`}
        </div>
        <div style="display:flex;gap:10px">
          <button type="button" class="btn ghost" onClick=${onClose}>Cancel</button>
          <button class="btn" disabled=${busy}>${busy ? "Saving…" : isNew ? "Drop pin" : "Save"}</button>
        </div>
      </div>
    </form>
  </${Modal}>`;
}
