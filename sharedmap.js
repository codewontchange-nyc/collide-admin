import { useState, useEffect, useRef, useCallback, useMemo } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Modal, uploadMedia, mediaUrl, CITIES, cityName } from "./ui.js?v=17";
import { EMOJI } from "./emoji-data.js?v=17";

/* The SAME map members see in the app: the hand-drawn artwork from map_config
   + map_events pins + community pins + POI dots, all positioned by x/y
   fractions. Every edit here writes the same rows the app reads (and vice
   versa, realtime) — one universal map. Clouds & birds match the app. */

const DEFAULT_RECENTS = ["📍", "🎉", "🎶", "🍕", "🍺", "🎨", "🏀", "🎬", "🌭", "☕", "🎪", "🕺"];

/* Recents + search over the full emoji set — same behavior as the mobile app's
   pin editor. Recents persist in localStorage. */
function EmojiPicker({ value, onPick }) {
  const [q, setQ] = useState("");
  const [recents, setRecents] = useState(() => {
    try {
      const r = JSON.parse(localStorage.getItem("ca.emoji.recent"));
      if (Array.isArray(r) && r.length) return r;
    } catch {}
    return DEFAULT_RECENTS;
  });
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? EMOJI.filter((e) => e[1].includes(needle)).slice(0, 60).map((e) => e[0])
    : recents;
  const pick = (em) => {
    onPick(em);
    try {
      const next = [em, ...recents.filter((r) => r !== em)].slice(0, 16);
      localStorage.setItem("ca.emoji.recent", JSON.stringify(next));
      setRecents(next);
    } catch {}
  };
  return html`<div>
    <input style="width:100%;padding:9px 12px;border:1px solid var(--line);border-radius:9px;margin-bottom:8px"
      placeholder="Search any emoji… pizza, dj, hike" value=${q} onInput=${(e) => setQ(e.target.value)} />
    ${!needle && html`<div class="tiny muted" style="font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Recent</div>`}
    <div style="display:flex;flex-wrap:wrap;gap:6px;max-height:168px;overflow-y:auto">
      ${shown.map((em) => html`<button type="button" key=${em} class="btn small ghost"
        style=${value === em ? "border-color:#17181a" : ""} onClick=${() => pick(em)}>${em}</button>`)}
      ${needle && !shown.length && html`<span class="tiny muted" style="padding:6px">No match — try another word</span>`}
    </div>
  </div>`;
}
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

export function SharedMap({ client, session, flash, readonly = false, compact = false, community = null, communities = [] }) {
  const [city, setCity] = useState(localStorage.getItem("ca.mapcity") || "nyc");
  const [cfg, setCfg] = useState(undefined);
  const [events, setEvents] = useState([]);
  const [comms, setComms] = useState([]);
  const [pois, setPois] = useState([]);
  const [editing, setEditing] = useState(null);   // {x,y,_new} | map_event row | {_kind:'poi', ...poi row}
  const wrap = useRef(null);
  const drag = useRef(null);

  const pickCity = (c) => { localStorage.setItem("ca.mapcity", c); setCfg(undefined); setCity(c); };

  const load = useCallback(async () => {
    const [c, e, k, p] = await Promise.all([
      client.from("map_config").select("*").eq("city", city).maybeSingle(),
      client.from("map_events").select("*").eq("city", city).order("created_at"),
      client.from("communities").select("id,name,emoji,x,y,archived_at").eq("city", city),
      client.from("pois").select("*").eq("city", city),
    ]);
    setCfg(c.data || null);
    setEvents((e.data || []).filter(alive));
    setComms((k.data || []).filter((r) => r.x != null && r.y != null && !r.archived_at));
    setPois((p.data || []).filter((r) => r.x != null && r.y != null));
  }, [client, city]);
  useEffect(() => { load(); }, [load]);

  /* realtime: app edits appear here live, and vice versa */
  useEffect(() => {
    const ch = client.channel("ca-map-" + Math.random().toString(36).slice(2, 6))
      .on("postgres_changes", { event: "*", schema: "public", table: "map_events" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "map_config" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "communities" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "pois" }, load)
      .subscribe();
    return () => { try { client.removeChannel(ch); } catch {} };
  }, [client, load]);

  const frac = (ev) => {
    const r = wrap.current.getBoundingClientRect();
    return { x: clamp01((ev.clientX - r.left) / r.width), y: clamp01((ev.clientY - r.top) / r.height) };
  };

  const onMapClick = (ev) => {
    if (readonly || drag.current?.moved) { drag.current = null; return; }
    if (ev.target.closest(".map-pin") || ev.target.closest(".map-poi")) return;
    setEditing({ ...frac(ev), _new: true });
  };

  /* drag pins (events + communities + POIs) — save x/y on release;
     a plain click (no movement) opens the editor for events & POIs */
  const startDrag = (row, table) => (ev) => {
    if (readonly) return;
    ev.stopPropagation(); ev.preventDefault();
    drag.current = { row, table, moved: false };
    const el = ev.currentTarget;
    const move = (e) => {
      const f = frac(e);
      drag.current.moved = true;
      drag.current.f = f;
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
      } else if (d && !d.moved) {
        if (d.table === "map_events") setEditing(d.row);
        if (d.table === "pois") setEditing({ ...d.row, _kind: "poi" });
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
      const path = `bg-${city}-${Date.now()}.${ext}`;
      const { error } = await client.storage.from("map").upload(path, file, { contentType: file.type || "image/jpeg", upsert: true });
      if (error) throw error;
      // one artwork row per city — first upload opens the city
      const { error: e2 } = await client.from("map_config").upsert(
        { city, image_path: path, updated_at: new Date().toISOString() }, { onConflict: "city" });
      if (e2) throw e2;
      flash(`${cityName(city)} artwork updated 🗺️`);
      load();
    } catch (e) { flash(e.message || String(e)); }
  };

  /* Cluster preview: the app folds any pins whose centers land within 46
     screen px (at its default zoom) into a count chip. Mirror that math here
     (phone fits map height ~700px, default zoom 1.3x) so staff can SEE which
     pins members experience as one chip — without breaking drag-to-edit. */
  const [aspect, setAspect] = useState(null);
  const clusterBadges = useMemo(() => {
    if (!aspect) return [];
    const H = 700 * 1.3, W = aspect * H;
    const pts = [
      ...pois.map((p) => ({ x: p.x, y: p.y })),
      ...events.map((e) => ({ x: e.x, y: e.y })),
    ].map((p) => ({ ...p, px: p.x * W, py: p.y * H }));
    const groups = [];
    for (const pt of pts.sort((a2, b2) => a2.py - b2.py || a2.px - b2.px)) {
      const g = groups.find((q2) => Math.hypot(q2.px / q2.n - pt.px, q2.py / q2.n - pt.py) < 46);
      if (g) { g.px += pt.px; g.py += pt.py; g.x += pt.x; g.y += pt.y; g.n++; }
      else groups.push({ px: pt.px, py: pt.py, x: pt.x, y: pt.y, n: 1 });
    }
    return groups.filter((g) => g.n > 1).map((g) => ({ x: g.x / g.n, y: g.y / g.n, n: g.n }));
  }, [aspect, pois, events]);

  const img = cfg === undefined ? undefined : mapImageUrl(client, cfg?.image_path);

  return html`<div>
    ${!compact && html`<div class="pagehead">
      <h2 style="margin:0">Map <span class="muted" style="font:400 13px Inter">the same map members see — edits are live in the app</span></h2>
      ${!readonly && html`<label class="btn ghost" style="cursor:pointer">${cfg ? "Replace" : "Upload"} ${cityName(city)} artwork<input type="file" accept="image/*" style="display:none" onChange=${uploadArt} /></label>`}
    </div>`}
    ${!compact && html`<div class="subnav" style="margin-bottom:12px">
      ${CITIES.map(([k, label]) => html`<button class=${city === k ? "on" : ""} onClick=${() => pickCity(k)}>${label}</button>`)}
    </div>`}
    ${img === undefined ? html`<div class="empty">Loading map…</div>`
      : !img ? html`<div class="empty">No ${cityName(city)} artwork yet — the cartographer is still inking 🖋️<br/><span class="tiny muted">Upload artwork above to open this city's map.</span></div>`
      : html`<div class=${"smap" + (compact ? " compact" : "")} ref=${wrap} onClick=${onMapClick}>
          <img class="smap-img" src=${img} alt="Community map" draggable=${false}
            ref=${(el) => { if (el && el.complete && el.naturalWidth) setAspect(el.naturalWidth / el.naturalHeight); }}
            onLoad=${(e) => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} />
          <${Clouds} />
          <${Birds} />
          ${pois.map((p) => html`<button key=${"p" + p.id} class="map-poi" title=${p.name}
              style=${`left:${p.x * 100}%;top:${p.y * 100}%`} onPointerDown=${startDrag(p, "pois")}></button>`)}
          ${clusterBadges.map((b, i) => html`<span key=${"cb" + i} class="smap-cluster"
              title="Members see these ${b.n} folded into one chip at default zoom"
              style=${`left:${b.x * 100}%;top:${b.y * 100}%`}>${b.n}</span>`)}
          ${events.map((e) => html`<button key=${e.id} class="map-pin" title=${e.title || ""}
              style=${`left:${e.x * 100}%;top:${e.y * 100}%`} onPointerDown=${startDrag(e, "map_events")}>
            <span class="pe">${e.venue ? VENUE_EMOJI[e.venue] : (e.emoji || "🎉")}</span>
            ${e.title && html`<span class="pl">${e.title}</span>`}
          </button>`)}
        </div>`}
    ${!compact && html`<p class="tiny muted" style="margin-top:10px">Click anywhere to drop an event pin or POI · drag anything to move it · click a pin or dot to edit. POI dots are the small black circles.</p>`}
    ${editing && html`<${PinModal} client=${client} session=${session} pin=${editing} flash=${flash}
      community=${community} communities=${communities} city=${city}
      onClose=${() => setEditing(null)} onSaved=${() => { setEditing(null); load(); }} />`}
  </div>`;
}

function PinModal({ client, session, pin, flash, community, communities, city = "nyc", onClose, onSaved }) {
  const isNew = !!pin._new;
  const isPoi = pin._kind === "poi";
  const [kind, setKind] = useState(isPoi ? "poi" : "event");
  const [f, setF] = useState({
    emoji: pin.emoji || "🎉", title: pin.title || "", at_time: pin.at_time || "",
    place: pin.place || "", note: pin.note || "", link: pin.link || "", venue: pin.venue || "",
    name: pin.name || "", category: pin.category || "", notes: pin.notes || "",
    address: pin.address || "", hours: pin.hours || "",
    // existing pins keep their real owner ("" = Collide/public); new ones default to the picked community
    community_id: pin._new ? (community?.id || communities[0]?.id || "") : (pin.community_id || ""),
  });
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null);
  const [gallery, setGallery] = useState(pin.images || []);   // storage paths already saved
  const [galleryFiles, setGalleryFiles] = useState([]);       // new files, uploaded on save
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (kind === "poi") {
        let image_path = pin.image_path || null;
        if (file) image_path = await uploadMedia(client, "poi", file);
        const uploaded = [];
        for (const gf of galleryFiles) uploaded.push(await uploadMedia(client, "poi", gf));
        const row = { name: f.name.trim() || "POI", category: f.category.trim() || null,
          notes: f.notes.trim() || null, community_id: f.community_id || null, image_path,
          address: f.address.trim() || null, hours: f.hours.trim() || null,
          link: f.link.trim() || null, images: [...gallery, ...uploaded] };
        if (isNew) {
          const { error } = await client.from("pois").insert({ ...row, x: pin.x, y: pin.y, city, created_by: session.user.id });
          if (error) throw error;
          flash("POI dotted 📍");
        } else {
          const { error } = await client.from("pois").update(row).eq("id", pin.id);
          if (error) throw error;
          flash("POI updated");
        }
      } else {
        const row = { emoji: f.emoji, title: f.title, at_time: f.at_time, place: f.place, note: f.note, link: f.link, venue: f.venue };
        if (isNew) {
          const { error } = await client.from("map_events").insert({ ...row, x: pin.x, y: pin.y, city, expires_at: plus7d(), created_by: session.user.id });
          if (error) throw error;
          flash("Pin dropped — live in the app 🎉");
        } else {
          const { error } = await client.from("map_events").update(row).eq("id", pin.id);
          if (error) throw error;
          flash("Pin updated");
        }
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
    const table = kind === "poi" ? "pois" : "map_events";
    if (!confirm(`Remove this ${kind === "poi" ? "POI" : "pin"} from the map?`)) return;
    const { error } = await client.from(table).delete().eq("id", pin.id);
    if (error) flash(error.message); else { flash("Removed"); onSaved(); }
  };

  return html`<${Modal} title=${isNew ? "Add to the map" : kind === "poi" ? "Edit POI" : "Edit pin"} onClose=${onClose}>
    <form onSubmit=${save}>
      ${isNew && html`<div class="field"><label>What is it?</label>
        <div style="display:flex;gap:6px">
          <button type="button" class="btn small ghost" style=${kind === "event" ? "border-color:#17181a;font-weight:700" : ""} onClick=${() => setKind("event")}>🎉 Event pin</button>
          <button type="button" class="btn small ghost" style=${kind === "poi" ? "border-color:#17181a;font-weight:700" : ""} onClick=${() => setKind("poi")}>⚫ Point of interest</button>
        </div></div>`}
      ${kind === "poi" ? html`
        <div class="fieldrow">
          <div class="field"><label>Name</label><input required value=${f.name} onInput=${set("name")} placeholder="Our Fav Coffee" /></div>
          <div class="field"><label>Category</label><input value=${f.category} onInput=${set("category")} placeholder="Coffee · Trail · Food…" /></div>
        </div>
        <div class="field"><label>Owner</label>
          <select value=${f.community_id} onChange=${set("community_id")}>
            <option value="">🌍 Collide (public — everyone sees it)</option>
            ${communities.map((c) => html`<option value=${c.id}>${c.name} (members only)</option>`)}
          </select></div>
        <div class="field"><label>Notes</label><input value=${f.notes} onInput=${set("notes")} placeholder="Why this spot matters" /></div>
        <div class="fieldrow">
          <div class="field"><label>Address</label><input value=${f.address} onInput=${set("address")} placeholder="188 Suydam St, Bushwick" /></div>
          <div class="field"><label>Hours</label><input value=${f.hours} onInput=${set("hours")} placeholder="7a–4p daily" /></div>
        </div>
        <div class="field"><label>Link</label><input value=${f.link} onInput=${set("link")} placeholder="https://…" /></div>
        <div class="field"><label>Cover image (dashboard grid + carousel fallback)</label>
          <input type="file" accept="image/*" onChange=${(e) => setFile(e.target.files[0] || null)} /></div>
        <div class="field"><label>Photo carousel (shows in the app's place drawer)</label>
          ${gallery.length > 0 && html`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
            ${gallery.map((p) => html`<div style="position:relative">
              <img src=${mediaUrl(client, p)} alt="" style="width:74px;height:52px;object-fit:cover;border-radius:8px" />
              <button type="button" title="Remove photo" onClick=${() => setGallery(gallery.filter((x) => x !== p))}
                style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:none;background:#17181a;color:#fff;font-size:11px;line-height:1;cursor:pointer">×</button>
            </div>`)}
          </div>`}
          <input type="file" accept="image/*" multiple onChange=${(e) => setGalleryFiles([...e.target.files])} />
          ${galleryFiles.length > 0 && html`<div class="tiny muted" style="margin-top:4px">${galleryFiles.length} new photo${galleryFiles.length > 1 ? "s" : ""} will upload on save</div>`}
        </div>
      ` : html`
        <div class="field"><label>Pin emoji ${f.emoji && html`<span style="font-size:15px">${f.emoji}</span>`}</label>
          <${EmojiPicker} value=${f.emoji} onPick=${(em) => setF({ ...f, emoji: em })} /></div>
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
      `}
      <div class="actions" style="justify-content:space-between">
        <div style="display:flex;gap:8px">
          ${!isNew && html`${kind !== "poi" && html`<button type="button" class="btn small ghost" onClick=${renew}>Renew 7d</button>`}
            <button type="button" class="btn small danger" onClick=${remove}>Remove</button>`}
        </div>
        <div style="display:flex;gap:10px">
          <button type="button" class="btn ghost" onClick=${onClose}>Cancel</button>
          <button class="btn" disabled=${busy}>${busy ? "Saving…" : isNew ? (kind === "poi" ? "Add POI" : "Drop pin") : "Save"}</button>
        </div>
      </div>
    </form>
  </${Modal}>`;
}
