import { useState, useEffect, useMemo, useRef, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from "https://esm.sh/d3-force@3.0.0";
import { html, fetchAll, cityName } from "./ui.js?v=45";

/* Network — the platform as a living social graph. Communities are squares,
   people are their profile pictures, and three kinds of ties run between them:
   membership (person → community), circles (person ↔ person, the app's friend
   graph) and co-attendance (two people who RSVP'd to the same plan). A time
   scrubber replays how the graph grew, and the insight rail turns the picture
   into the numbers an investor asks for: bridges between communities, density
   inside them, how much of the platform is one connected whole.

   Rendering is a canvas + d3-force; everything else is Preact. */

const PALETTE = ["#e85d75", "#2fb3a5", "#f0a830", "#8b6cf0", "#4c9be8", "#7cc242", "#f27d3a", "#e6c14a", "#d95bb6", "#39c2d7", "#a3e078", "#ff8fa3"];
const CITY_COLOR = { nyc: "#e85d75", atl: "#2fb3a5", global: "#f0a830" };
const CITY_X = { nyc: -0.28, atl: 0.28 };   // fraction of stage width the city clusters gravitate to
const DAY = 864e5;
const ms = (iso) => (iso ? +new Date(iso) : 0);
const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const initials = (n) => (n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const pct = (n, d) => (d ? Math.round((n / d) * 100) + "%" : "—");

/* ---------- data → graph ---------- */
async function loadGraph(client) {
  const [comm, prof, mem, conn, rsvp, act] = await Promise.all([
    client.from("communities").select("id,name,emoji,city,image_path,created_at,archived_at"),
    fetchAll((a, b) => client.from("profiles").select("id,display_name,avatar_url,created_at,home_city").range(a, b)),
    fetchAll((a, b) => client.from("community_members").select("community_id,profile_id,status,joined_at").range(a, b)),
    fetchAll((a, b) => client.from("connections").select("a,b,status,created_at,requested_by").range(a, b)),
    fetchAll((a, b) => client.from("rsvps").select("activity_id,profile_id,status,created_at").eq("status", "going").range(a, b)),
    fetchAll((a, b) => client.from("activities").select("id,community_id,title,date,created_at").range(a, b)),
  ]);
  const err = [comm, prof, mem, conn, rsvp, act].find((r) => r.error);
  if (err) throw new Error(err.error.message);
  return { communities: (comm.data || []).filter((c) => !c.archived_at), people: prof.data || [], memberships: mem.data || [],
    connections: conn.data || [], rsvps: rsvp.data || [], activities: act.data || [] };
}

function buildGraph(d) {
  const nodes = [], byId = new Map();
  d.communities.forEach((c, i) => {
    const n = { id: "c:" + c.id, kind: "c", ref: c, name: c.name, emoji: c.emoji || "🏘️", city: c.city || "global",
      color: PALETTE[i % PALETTE.length], t0: ms(c.created_at), members: 0, x: (Math.random() - 0.5) * 400, y: (Math.random() - 0.5) * 400 };
    nodes.push(n); byId.set(n.id, n);
  });
  d.people.forEach((p) => {
    const n = { id: "p:" + p.id, kind: "p", ref: p, name: p.display_name || "Someone", city: p.home_city || "global",
      t0: ms(p.created_at), comms: [], deg: 0, x: (Math.random() - 0.5) * 600, y: (Math.random() - 0.5) * 600 };
    nodes.push(n); byId.set(n.id, n);
  });
  const links = [];
  d.memberships.forEach((m) => {
    if (m.status !== "member") return;
    const s = byId.get("p:" + m.profile_id), t = byId.get("c:" + m.community_id);
    if (!s || !t) return;
    const l = { source: s, target: t, kind: "m", t0: ms(m.joined_at) || t.t0, color: t.color };
    links.push(l); s.comms.push(t); t.members++;
  });
  d.connections.forEach((c) => {
    const s = byId.get("p:" + c.a), t = byId.get("p:" + c.b);
    if (!s || !t) return;
    links.push({ source: s, target: t, kind: "x", t0: ms(c.created_at), pending: c.status !== "accepted", from: byId.get("p:" + c.requested_by) });
    if (c.status === "accepted") { s.deg++; t.deg++; }
  });
  // co-attendance: everyone who RSVP'd "going" to the same plan, weighted by how many plans they've shared
  const actDate = new Map(d.activities.map((a) => [a.id, ms(a.date ? a.date + "T12:00:00" : a.created_at)]));
  const byAct = new Map();
  d.rsvps.forEach((r) => { if (!byAct.has(r.activity_id)) byAct.set(r.activity_id, []); byAct.get(r.activity_id).push(r.profile_id); });
  const pairs = new Map();
  byAct.forEach((ids, aid) => {
    const when = actDate.get(aid) || 0;
    ids.sort();
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const k = ids[i] + "|" + ids[j], e = pairs.get(k);
      if (e) { e.w++; e.t0 = Math.min(e.t0, when); } else pairs.set(k, { a: ids[i], b: ids[j], w: 1, t0: when });
    }
  });
  pairs.forEach((e) => {
    const s = byId.get("p:" + e.a), t = byId.get("p:" + e.b);
    if (s && t) links.push({ source: s, target: t, kind: "e", w: e.w, t0: e.t0 });
  });
  nodes.forEach((n) => {
    if (n.kind === "c") n.size = Math.min(92, 46 + n.members * 4);
    else { n.r = Math.min(19, 9.5 + n.deg * 1.1 + n.comms.length * 1.2); n.color = n.comms[0]?.color || CITY_COLOR[n.city] || "#9a8f86"; }
  });
  const times = [...nodes.map((n) => n.t0), ...links.map((l) => l.t0)].filter(Boolean);
  const tMin = Math.min(...times) - DAY, tMax = Date.now();
  return { nodes, links, byId, tMin, tMax, activities: d.activities, actDate };
}

/* ---------- insights on the graph as it stood at time t ---------- */
function insightsAt(g, t) {
  const vis = (n) => n.t0 <= t;
  const people = g.nodes.filter((n) => n.kind === "p" && vis(n));
  const comms = g.nodes.filter((n) => n.kind === "c" && vis(n));
  const L = g.links.filter((l) => l.t0 <= t && vis(l.source) && vis(l.target));
  const mem = L.filter((l) => l.kind === "m"), circ = L.filter((l) => l.kind === "x" && !l.pending), co = L.filter((l) => l.kind === "e");
  const commsOf = new Map(); mem.forEach((l) => { if (!commsOf.has(l.source.id)) commsOf.set(l.source.id, new Set()); commsOf.get(l.source.id).add(l.target.id); });
  const deg = new Map(); circ.forEach((l) => { deg.set(l.source.id, (deg.get(l.source.id) || 0) + 1); deg.set(l.target.id, (deg.get(l.target.id) || 0) + 1); });
  const bridges = people.filter((p) => (commsOf.get(p.id)?.size || 0) >= 2).sort((a, b) => commsOf.get(b.id).size - commsOf.get(a.id).size);
  const connectors = [...people].filter((p) => deg.get(p.id)).sort((a, b) => (deg.get(b.id) || 0) - (deg.get(a.id) || 0));
  const cross = circ.filter((l) => { const A = commsOf.get(l.source.id), B = commsOf.get(l.target.id); if (!A || !B) return true; for (const c of A) if (B.has(c)) return false; return true; }).length;
  // union-find over memberships + circles: what share of people are one connected whole?
  const par = new Map(); const find = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
  [...people, ...comms].forEach((n) => par.set(n.id, n.id));
  [...mem, ...circ].forEach((l) => par.set(find(l.source.id), find(l.target.id)));
  const compSize = new Map(); people.forEach((p) => { const r = find(p.id); compSize.set(r, (compSize.get(r) || 0) + 1); });
  const giant = Math.max(0, ...compSize.values());
  const inAny = people.filter((p) => commsOf.has(p.id)).length;
  // per-community density: accepted circles among members ÷ possible pairs
  const density = comms.map((c) => {
    const ids = new Set(mem.filter((l) => l.target === c).map((l) => l.source.id));
    const n = ids.size, inside = circ.filter((l) => ids.has(l.source.id) && ids.has(l.target.id)).length;
    const shared = [...ids].filter((id) => commsOf.get(id).size > 1).length;
    return { c, n, inside, density: n > 1 ? inside / (n * (n - 1) / 2) : 0, shared };
  }).sort((a, b) => b.n - a.n);
  const recent = (arr) => arr.filter((x) => x.t0 > t - 30 * DAY).length;
  const events = g.activities.filter((a) => (g.actDate.get(a.id) || 0) <= t).length;
  const cities = {}; people.forEach((p) => { cities[p.city] = (cities[p.city] || 0) + 1; });
  return { people: people.length, comms: comms.length, mem: mem.length, circ: circ.length, co: co.length, events,
    bridges, connectors, deg, commsOf, cross, giant, inAny, density, cities,
    avgCircle: people.length ? (circ.length * 2 / people.length) : 0,
    newPeople: recent(people), newCirc: recent(circ), newMem: recent(mem) };
}

// weekly cumulative series for the scrubber's area chart
function growthSeries(g) {
  const weeks = Math.max(2, Math.ceil((g.tMax - g.tMin) / (7 * DAY)) + 1);
  const P = new Array(weeks).fill(0), X = new Array(weeks).fill(0), M = new Array(weeks).fill(0);
  const idx = (t) => Math.min(weeks - 1, Math.max(0, Math.floor((t - g.tMin) / (7 * DAY))));
  g.nodes.forEach((n) => { if (n.kind === "p") P[idx(n.t0)]++; });
  g.links.forEach((l) => { if (l.kind === "x" && !l.pending) X[idx(l.t0)]++; if (l.kind === "m") M[idx(l.t0)]++; });
  for (let i = 1; i < weeks; i++) { P[i] += P[i - 1]; X[i] += X[i - 1]; M[i] += M[i - 1]; }
  return { P, X, M, weeks };
}

/* ---------- avatar cache (canvas-safe) ---------- */
const imgCache = new Map();
function avatarImg(p) {
  const raw = p.avatar_url; if (!raw) return null;
  if (imgCache.has(raw)) { const im = imgCache.get(raw); return im.complete && im.naturalWidth ? im : null; }
  const im = new Image(); im.crossOrigin = "anonymous";
  im.src = raw.startsWith("http") ? raw : `${window.CA_CONFIG?.SUPABASE_URL || ""}/storage/v1/object/public/avatars/${raw}`;
  imgCache.set(raw, im); return null;
}

/* ---------- the page ---------- */
export function NetworkPage({ client, flash }) {
  const [g, setG] = useState(null);
  const [err, setErr] = useState(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [layers, setLayers] = useState({ m: true, x: true, e: false, pending: false, labels: true, cityPull: true });
  const [colorBy, setColorBy] = useState("community");   // community | city
  const [focus, setFocus] = useState(null);   // node id
  const [hover, setHover] = useState(null);   // { node, x, y }
  const [q, setQ] = useState("");
  const wrap = useRef(null), canvas = useRef(null);
  const view = useRef({ k: 1, tx: 0, ty: 0 });
  const sim = useRef(null);
  const tRef = useRef(0), appear = useRef(new Map());
  const focusRef = useRef(null), layersRef = useRef(layers), colorRef = useRef(colorBy), hoverRef = useRef(null);
  focusRef.current = focus; layersRef.current = layers; colorRef.current = colorBy;

  useEffect(() => {
    let live = true;
    loadGraph(client).then((d) => { if (!live) return; const gg = buildGraph(d); setG(gg); setT(gg.tMax); tRef.current = gg.tMax; })
      .catch((e) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [client]);

  const series = useMemo(() => (g ? growthSeries(g) : null), [g]);
  const tDay = Math.floor(t / DAY) * DAY;
  const ins = useMemo(() => (g ? insightsAt(g, tDay + DAY) : null), [g, tDay]);

  /* force layout */
  useEffect(() => {
    if (!g || !wrap.current) return;
    const W = wrap.current.clientWidth, H = wrap.current.clientHeight;
    const s = forceSimulation(g.nodes)
      .force("link", forceLink(g.links).id((n) => n.id)
        .distance((l) => (l.kind === "m" ? 40 + l.target.size / 2 : l.kind === "x" ? 78 : 130))
        .strength((l) => (l.kind === "m" ? 0.55 : l.kind === "x" ? (l.pending ? 0.05 : 0.25) : 0.02)))
      .force("charge", forceManyBody().strength((n) => (n.kind === "c" ? -1500 : -140)).distanceMax(800))
      .force("collide", forceCollide().radius((n) => (n.kind === "c" ? n.size * 0.85 + 14 : n.r + 6)).iterations(2))
      // people with no ties yet get a firmer pull to the middle so they don't drift off-stage
      .force("x", forceX((n) => (layersRef.current.cityPull ? (CITY_X[n.city] || 0) * W * (n.kind === "c" || n.comms.length || n.deg ? 1 : 0.55) : 0)).strength((n) => (n.kind === "c" ? 0.12 : n.comms.length || n.deg ? 0.07 : 0.16)))
      .force("y", forceY(0).strength((n) => (n.kind === "c" || n.comms.length || n.deg ? 0.07 : 0.16)))
      .alphaDecay(0.02).velocityDecay(0.5);
    // settle the layout up front (synchronously) so the first frame is already the picture,
    // then let it breathe at low energy instead of wandering into place on screen
    s.stop().tick(320); s.alpha(0.25).restart();
    sim.current = s;
    view.current = { k: Math.min(1, Math.min(W, H) / 900), tx: W / 2, ty: H / 2 };
    // frame the graph once the layout has mostly settled (and again when it ends)
    const ids = [60, 1500, 4000].map((d) => setTimeout(() => fitRef.current?.(), d));
    s.on("end", () => fitRef.current?.());
    return () => { ids.forEach(clearTimeout); s.stop(); };
  }, [g]);
  useEffect(() => { sim.current?.force("x")?.initialize(g?.nodes || []); sim.current?.alpha(0.5).restart(); }, [layers.cityPull]);

  /* playback */
  useEffect(() => {
    if (!playing || !g) return;
    let raf; const span = g.tMax - g.tMin, secs = 14;
    let last = performance.now();
    const step = (now) => {
      const dt = now - last; last = now;
      let nt = tRef.current + (span / (secs * 1000)) * dt;
      if (nt >= g.tMax) { nt = g.tMax; setPlaying(false); }
      tRef.current = nt; setT(nt);
      raf = requestAnimationFrame(step);
    };
    if (tRef.current >= g.tMax - 1000) { tRef.current = g.tMin; appear.current.clear(); }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, g]);
  const scrub = (v) => { const nt = +v; if (nt < tRef.current) appear.current.clear(); tRef.current = nt; setT(nt); };

  /* draw loop */
  useEffect(() => {
    if (!g || !canvas.current) return;
    const cv = canvas.current, ctx = cv.getContext("2d");
    let raf, W = 0, H = 0;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      W = wrap.current.clientWidth; H = wrap.current.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
    });
    ro.observe(wrap.current);
    const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!W) return;
      const dpr = window.devicePixelRatio || 1, { k, tx, ty } = view.current, now = performance.now(), T = tRef.current;
      const Ly = layersRef.current, cb = colorRef.current, F = focusRef.current ? g.byId.get(focusRef.current) : null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bg = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, Math.max(W, H) * 0.75);
      bg.addColorStop(0, "#2a211c"); bg.addColorStop(1, "#150f0c");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty);

      for (const n of g.nodes) { if (n.dx === undefined) { n.dx = n.x; n.dy = n.y; } else { n.dx += (n.x - n.dx) * 0.22; n.dy += (n.y - n.dy) * 0.22; } }
      const visN = (n) => n.t0 <= T, visL = (l) => l.t0 <= T && visN(l.source) && visN(l.target);
      const nb = new Set(); if (F) { nb.add(F.id); g.links.forEach((l) => { if (!visL(l) || l.kind === "e") return; if (l.source === F) nb.add(l.target.id); if (l.target === F) nb.add(l.source.id); }); }
      const dim = (n) => (F && !nb.has(n.id));
      const scaleOf = (n) => { let a = appear.current.get(n.id); if (!a) { a = now; appear.current.set(n.id, a); } const p = Math.min(1, (now - a) / 520); return 1 - Math.pow(1 - p, 3); };
      const colorOf = (n) => (cb === "city" ? (CITY_COLOR[n.city] || "#9a8f86") : n.color);

      // edges
      ctx.lineCap = "round";
      for (const l of g.links) {
        if (!visL(l)) continue;
        if (l.kind === "m" && !Ly.m) continue; if (l.kind === "x" && (!Ly.x || (l.pending && !Ly.pending))) continue; if (l.kind === "e" && !Ly.e) continue;
        const faded = F && !(nb.has(l.source.id) && nb.has(l.target.id));
        const sc = Math.min(scaleOf(l.source), scaleOf(l.target));
        ctx.globalAlpha = (faded ? 0.06 : 1) * sc;
        if (l.kind === "m") { ctx.strokeStyle = cb === "city" ? colorOf(l.target) : l.color; ctx.lineWidth = 1.3; ctx.globalAlpha *= 0.42; ctx.setLineDash([]); }
        else if (l.kind === "x") { ctx.strokeStyle = "#f6ecdf"; ctx.lineWidth = l.pending ? 1 : 1.6; ctx.globalAlpha *= l.pending ? 0.28 : 0.62; ctx.setLineDash(l.pending ? [4, 5] : []); }
        else { ctx.strokeStyle = "#f0a830"; ctx.lineWidth = 0.7 + l.w * 0.6; ctx.globalAlpha *= 0.16; ctx.setLineDash([]); }
        ctx.beginPath(); ctx.moveTo(l.source.dx, l.source.dy); ctx.lineTo(l.target.dx, l.target.dy); ctx.stroke();
      }
      ctx.setLineDash([]);

      // communities: squares
      for (const n of g.nodes) {
        if (n.kind !== "c" || !visN(n)) continue;
        const sc = scaleOf(n), s = n.size * sc, x = n.dx - s / 2, y = n.dy - s / 2, col = colorOf(n);
        ctx.globalAlpha = dim(n) ? 0.16 : 1;
        ctx.shadowColor = col; ctx.shadowBlur = F === n ? 44 : 22;
        ctx.fillStyle = col; rr(x, y, s, s, s * 0.22); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255,255,255,.14)"; rr(x + 2, y + 2, s - 4, s * 0.42, s * 0.18); ctx.fill();
        ctx.font = `${Math.round(s * 0.46)}px system-ui, "Apple Color Emoji", sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "#fff"; ctx.fillText(n.emoji, n.dx, n.dy + s * 0.02);
        if (Ly.labels || F === n || nb.has(n.id)) {
          ctx.font = `600 ${13 / Math.sqrt(k)}px Inter, system-ui, sans-serif`; ctx.textBaseline = "top";
          ctx.lineWidth = 4 / Math.sqrt(k); ctx.strokeStyle = "rgba(21,15,12,.85)"; ctx.lineJoin = "round";
          const label = n.name, my = n.dy + s / 2 + 7;
          ctx.strokeText(label, n.dx, my); ctx.fillStyle = "#fbf6f0"; ctx.fillText(label, n.dx, my);
          ctx.font = `500 ${11 / Math.sqrt(k)}px Inter, system-ui, sans-serif`; ctx.fillStyle = "rgba(251,246,240,.62)";
          const mc = g.links.filter((l) => l.kind === "m" && l.target === n && visL(l)).length;
          ctx.strokeText(`${mc} member${mc === 1 ? "" : "s"} · ${cityName(n.city)}`, n.dx, my + 16 / Math.sqrt(k)); ctx.fillText(`${mc} member${mc === 1 ? "" : "s"} · ${cityName(n.city)}`, n.dx, my + 16 / Math.sqrt(k));
        }
      }
      // people: profile pictures
      const showNames = Ly.labels && k > 1.35;
      for (const n of g.nodes) {
        if (n.kind !== "p" || !visN(n)) continue;
        const sc = scaleOf(n), r = n.r * sc, col = colorOf(n), hi = F === n || hoverRef.current?.node === n;
        ctx.globalAlpha = dim(n) ? 0.14 : 1;
        if (hi) { ctx.shadowColor = col; ctx.shadowBlur = 26; }
        ctx.beginPath(); ctx.arc(n.dx, n.dy, r + 2, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
        ctx.shadowBlur = 0;
        const im = avatarImg(n.ref);
        ctx.save(); ctx.beginPath(); ctx.arc(n.dx, n.dy, r, 0, Math.PI * 2); ctx.clip();
        if (im) ctx.drawImage(im, n.dx - r, n.dy - r, r * 2, r * 2);
        else { ctx.fillStyle = "#3a2f29"; ctx.fillRect(n.dx - r, n.dy - r, r * 2, r * 2); ctx.fillStyle = "#fbf6f0"; ctx.font = `600 ${Math.max(7, r * 0.85)}px Inter, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(initials(n.name), n.dx, n.dy + r * 0.05); }
        ctx.restore();
        if ((showNames || hi || (F && nb.has(n.id))) && !dim(n)) {
          ctx.font = `500 ${11 / Math.sqrt(k)}px Inter, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "top";
          ctx.lineWidth = 3.5 / Math.sqrt(k); ctx.strokeStyle = "rgba(21,15,12,.85)"; ctx.lineJoin = "round";
          ctx.strokeText(n.name, n.dx, n.dy + r + 5); ctx.fillStyle = "#fbf6f0"; ctx.fillText(n.name, n.dx, n.dy + r + 5);
        }
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [g]);

  /* pointer: pan / zoom / drag / hover / focus */
  const toWorld = (e) => { const b = canvas.current.getBoundingClientRect(), { k, tx, ty } = view.current; return [(e.clientX - b.left - tx) / k, (e.clientY - b.top - ty) / k]; };
  const hit = (wx, wy) => {
    const T = tRef.current; let best = null;
    for (let i = g.nodes.length - 1; i >= 0; i--) {
      const n = g.nodes[i]; if (n.t0 > T) continue;
      const rad = n.kind === "c" ? n.size / 2 : n.r + 3;
      const nx = n.dx ?? n.x, ny = n.dy ?? n.y;
      if (Math.abs(nx - wx) <= rad && Math.abs(ny - wy) <= rad) { if (n.kind === "p") return n; best = best || n; }
    }
    return best;
  };
  const drag = useRef(null);
  const onDown = (e) => {
    if (!g) return; canvas.current.setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.current.size === 2) {   // second finger: switch from drag/pan to pinch
      const [a, b] = [...pts.current.values()], bx = canvas.current.getBoundingClientRect();
      if (drag.current?.n) { drag.current.n.fx = null; drag.current.n.fy = null; }
      drag.current = null;
      pinch.current = { d0: Math.hypot(a[0] - b[0], a[1] - b[1]), k0: view.current.k, cx: (a[0] + b[0]) / 2 - bx.left, cy: (a[1] + b[1]) / 2 - bx.top };
      return;
    }
    const [wx, wy] = toWorld(e), n = hit(wx, wy);
    drag.current = { n, sx: e.clientX, sy: e.clientY, tx: view.current.tx, ty: view.current.ty, moved: false };
    if (n) { n.fx = n.x; n.fy = n.y; sim.current.alphaTarget(0.12).restart(); }
  };
  const onMove = (e) => {
    if (!g) return;
    if (pts.current.has(e.pointerId)) pts.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch.current && pts.current.size >= 2) {
      const [a, b] = [...pts.current.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), p = pinch.current;
      const k2 = Math.min(6, Math.max(0.15, p.k0 * (d / p.d0))), v = view.current;
      v.tx = p.cx - (p.cx - v.tx) * (k2 / v.k); v.ty = p.cy - (p.cy - v.ty) * (k2 / v.k); v.k = k2;
      return;
    }
    const d = drag.current;
    if (d) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 3) d.moved = true;
      if (d.n) { const [wx, wy] = toWorld(e); d.n.fx = wx; d.n.fy = wy; d.n.dx = wx; d.n.dy = wy; }
      else { view.current.tx = d.tx + (e.clientX - d.sx); view.current.ty = d.ty + (e.clientY - d.sy); }
      return;
    }
    const [wx, wy] = toWorld(e), n = hit(wx, wy);
    const b = canvas.current.getBoundingClientRect();
    const h = n ? { node: n, x: e.clientX - b.left, y: e.clientY - b.top } : null;
    hoverRef.current = h; setHover((prev) => (prev?.node === n && n ? { ...prev, x: h.x, y: h.y } : h));
    canvas.current.style.cursor = n ? "pointer" : "grab";
  };
  const onUp = (e) => {
    pts.current.delete(e.pointerId);
    if (pinch.current) { if (pts.current.size < 2) pinch.current = null; return; }
    const d = drag.current; drag.current = null; if (!d) return;
    if (d.n) { d.n.fx = null; d.n.fy = null; sim.current.alphaTarget(0); }
    if (!d.moved) setFocus((f) => (d.n ? (f === d.n.id ? null : d.n.id) : null));
  };
  const zoomBy = (f, cx, cy) => {
    const v = view.current, W = wrap.current.clientWidth, H = wrap.current.clientHeight;
    const mx = cx ?? (W - (W > 1100 ? 336 : 0)) / 2, my = cy ?? H / 2, k2 = Math.min(6, Math.max(0.15, v.k * f));
    v.tx = mx - (mx - v.tx) * (k2 / v.k); v.ty = my - (my - v.ty) * (k2 / v.k); v.k = k2;
  };
  const zoomStep = (dir) => { let i = 0; const tick = () => { zoomBy(dir > 0 ? 1.06 : 1 / 1.06); if (++i < 8) requestAnimationFrame(tick); }; tick(); };
  const pinch = useRef(null);   // { d0, k0, cx, cy } while two pointers are down
  const pts = useRef(new Map());
  const onWheel = (e) => {
    e.preventDefault(); const b = canvas.current.getBoundingClientRect(), v = view.current;
    const mx = e.clientX - b.left, my = e.clientY - b.top, f = Math.exp(-e.deltaY * 0.0016), k2 = Math.min(6, Math.max(0.15, v.k * f));
    v.tx = mx - (mx - v.tx) * (k2 / v.k); v.ty = my - (my - v.ty) * (k2 / v.k); v.k = k2;
  };
  const fitRef = useRef(null);
  const fit = () => {
    if (!g || !wrap.current) return;
    const T = tRef.current, vis = g.nodes.filter((n) => n.t0 <= T); if (!vis.length) return;
    // frame the body of the graph, not the one straggler: trim 4% off each edge once there are enough nodes
    const q = (arr, f) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(f * (arr.length - 1))))];
    const xs = vis.map((n) => n.x).sort((a, b) => a - b), ys = vis.map((n) => n.y).sort((a, b) => a - b), W = wrap.current.clientWidth, H = wrap.current.clientHeight;
    const lo = vis.length > 20 ? 0.04 : 0, hi = 1 - lo;
    const x0 = q(xs, lo) - 70, x1 = q(xs, hi) + 70, y0 = q(ys, lo) - 70, y1 = q(ys, hi) + 70;
    // frame inside the clear stage: right rail (336) and the control bar / scrubber (top 110, bottom 100)
    const rail = W > 1100 ? 336 : 0, top = 110, bot = 100, aw = W - rail - 24, ah = H - top - bot;
    const k = Math.min(6, Math.max(0.15, Math.min(aw / (x1 - x0), ah / (y1 - y0))));
    view.current = { k, tx: 12 + aw / 2 - ((x0 + x1) / 2) * k, ty: top + ah / 2 - ((y0 + y1) / 2) * k };
  };
  fitRef.current = fit;
  const goTo = (id) => { const n = g?.byId.get(id); if (!n) return; setFocus(id); const W = wrap.current.clientWidth, H = wrap.current.clientHeight, k = Math.max(view.current.k, 1.6); view.current = { k, tx: W / 2 - n.x * k, ty: H / 2 - n.y * k }; };
  const snapshot = () => {
    const a = document.createElement("a"); a.download = `collide-network-${new Date(t).toISOString().slice(0, 10)}.png`;
    try { a.href = canvas.current.toDataURL("image/png"); a.click(); flash("Snapshot saved 📸"); } catch { flash("Couldn't export — an avatar blocked cross-origin drawing"); }
  };
  const matches = useMemo(() => { const n = q.trim().toLowerCase(); if (!g || !n) return []; return g.nodes.filter((x) => x.name.toLowerCase().includes(n)).slice(0, 8); }, [q, g]);
  const toggle = (k) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const F = focus && g ? g.byId.get(focus) : null;

  if (err) return html`<div class="empty">Couldn't load the network: ${err}</div>`;
  return html`<div class="net" ref=${wrap}>
    <canvas ref=${canvas} onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${onUp} onWheel=${onWheel}
      onPointerLeave=${() => { hoverRef.current = null; setHover(null); }} />
    ${!g && html`<div class="net-loading">Mapping the network…</div>`}

    <div class="net-bar">
      <div class="net-title"><b>Network</b><span>${g ? `${ins.people} people · ${ins.comms} communities · as of ${fmtDate(t)}` : "…"}</span></div>
      <div class="net-search">
        <input placeholder="Find a person or community…" value=${q} onInput=${(e) => setQ(e.target.value)}
          onKeyDown=${(e) => { if (e.key === "Enter" && matches[0]) { goTo(matches[0].id); setQ(""); } if (e.key === "Escape") setQ(""); }} />
        ${matches.length > 0 && html`<div class="net-matches">${matches.map((m) => html`<button onClick=${() => { goTo(m.id); setQ(""); }}>${m.kind === "c" ? m.emoji + " " : ""}${m.name}<span>${m.kind === "c" ? "community" : cityName(m.city)}</span></button>`)}</div>`}
      </div>
      <div class="net-chips">
        <button class=${layers.m ? "on" : ""} onClick=${() => toggle("m")}><i style="background:#8b6cf0"></i>Memberships</button>
        <button class=${layers.x ? "on" : ""} onClick=${() => toggle("x")}><i style="background:#f6ecdf"></i>Circles</button>
        <button class=${layers.e ? "on" : ""} onClick=${() => toggle("e")}><i style="background:#f0a830"></i>Went together</button>
        <button class=${layers.pending ? "on" : ""} onClick=${() => toggle("pending")}><i class="dash"></i>Pending</button>
        <span class="sep"></span>
        <button class=${colorBy === "community" ? "on" : ""} onClick=${() => setColorBy("community")}>By community</button>
        <button class=${colorBy === "city" ? "on" : ""} onClick=${() => setColorBy("city")}>By city</button>
        <span class="sep"></span>
        <button class=${layers.cityPull ? "on" : ""} onClick=${() => toggle("cityPull")} title="Pull each city into its own half of the stage">City gravity</button>
        <button class=${layers.labels ? "on" : ""} onClick=${() => toggle("labels")}>Labels</button>
        <span class="sep"></span>
        <button onClick=${fit}>Fit</button>
        <button onClick=${snapshot}>Snapshot</button>
      </div>
    </div>
    <div class="net-zoom">
      <button onClick=${() => zoomStep(1)} title="Zoom in">＋</button>
      <button onClick=${() => zoomStep(-1)} title="Zoom out">－</button>
      <button onClick=${fit} title="Fit everything">⤢</button>
    </div>

    ${g && ins && html`<aside class="net-rail">
      ${F ? html`<div class="net-card net-focus">
          <button class="x" onClick=${() => setFocus(null)}>✕</button>
          <div class="who"><span class="sq" style=${`background:${colorBy === "city" ? (CITY_COLOR[F.city] || "#9a8f86") : F.color}`}>${F.kind === "c" ? F.emoji : initials(F.name)}</span>
            <div><b>${F.name}</b><div class="tiny">${F.kind === "c" ? `community · ${cityName(F.city)}` : `${cityName(F.city)} · joined ${fmtDate(F.t0)}`}</div></div></div>
          ${F.kind === "p" ? html`<div class="kv"><span>Communities</span><b>${ins.commsOf.get(F.id)?.size || 0}</b></div>
            <div class="kv"><span>Circle</span><b>${ins.deg.get(F.id) || 0} people</b></div>
            <div class="kv"><span>Plans with others</span><b>${g.links.filter((l) => l.kind === "e" && l.t0 <= t && (l.source === F || l.target === F)).reduce((a, l) => a + l.w, 0)}</b></div>
            <div class="list">${[...(ins.commsOf.get(F.id) || [])].map((cid) => { const c = g.byId.get(cid); return html`<button onClick=${() => goTo(cid)}><i style=${`background:${c.color}`}></i>${c.emoji} ${c.name}</button>`; })}</div>`
          : html`<div class="kv"><span>Members</span><b>${ins.density.find((d) => d.c === F)?.n || 0}</b></div>
            <div class="kv"><span>Circles inside</span><b>${ins.density.find((d) => d.c === F)?.inside || 0}</b></div>
            <div class="kv"><span>Density</span><b>${pct(Math.round((ins.density.find((d) => d.c === F)?.density || 0) * 100), 100)}</b></div>
            <div class="kv"><span>Also elsewhere</span><b>${ins.density.find((d) => d.c === F)?.shared || 0} members</b></div>`}
        </div>` : ""}

      <div class="net-card">
        <div class="net-kpis">
          <div><b>${ins.people}</b><span>people</span>${ins.newPeople > 0 && html`<em>+${ins.newPeople} /30d</em>`}</div>
          <div><b>${ins.circ}</b><span>circles</span>${ins.newCirc > 0 && html`<em>+${ins.newCirc} /30d</em>`}</div>
          <div><b>${ins.mem}</b><span>memberships</span>${ins.newMem > 0 && html`<em>+${ins.newMem} /30d</em>`}</div>
          <div><b>${ins.events}</b><span>plans happened</span></div>
        </div>
      </div>

      <div class="net-card">
        <div class="net-h">How connected is the platform?</div>
        <div class="kv"><span>One connected whole</span><b>${pct(ins.giant, ins.people)}</b></div>
        <div class="bar"><i style=${`width:${pct(ins.giant, ins.people)}`}></i></div>
        <div class="kv"><span>In at least one community</span><b>${pct(ins.inAny, ins.people)}</b></div>
        <div class="kv"><span>Avg circle size</span><b>${ins.avgCircle.toFixed(1)}</b></div>
        <div class="kv" title="Accepted circles whose two people share no community — friendships the platform made across its walls"><span>Cross-community circles</span><b>${pct(ins.cross, ins.circ)}</b></div>
        <div class="kv"><span>Went to a plan together</span><b>${ins.co} pairs</b></div>
      </div>

      <div class="net-card">
        <div class="net-h">Bridges <span>${ins.bridges.length} people in 2+ communities</span></div>
        ${ins.bridges.length === 0 ? html`<div class="tiny muted">None yet at this point in time.</div>`
          : ins.bridges.slice(0, 5).map((p) => html`<button class="row" onClick=${() => goTo(p.id)}>
              <span class="av" style=${`background:${p.color}`}>${p.ref.avatar_url ? html`<img src=${avatarSrc(p.ref)} alt="" />` : initials(p.name)}</span>
              <span class="nm">${p.name}</span><span class="dots">${[...ins.commsOf.get(p.id)].map((cid) => html`<i style=${`background:${g.byId.get(cid).color}`}></i>`)}</span></button>`)}
      </div>

      <div class="net-card">
        <div class="net-h">Connectors <span>largest circles</span></div>
        ${ins.connectors.slice(0, 5).map((p) => html`<button class="row" onClick=${() => goTo(p.id)}>
          <span class="av" style=${`background:${p.color}`}>${p.ref.avatar_url ? html`<img src=${avatarSrc(p.ref)} alt="" />` : initials(p.name)}</span>
          <span class="nm">${p.name}</span><b>${ins.deg.get(p.id)}</b></button>`)}
      </div>

      <div class="net-card">
        <div class="net-h">Communities <span>size · density · overlap</span></div>
        ${ins.density.map((d) => html`<button class="row comm" onClick=${() => goTo(d.c.id)}>
          <span class="sq" style=${`background:${d.c.color}`}>${d.c.emoji}</span>
          <span class="nm">${d.c.name}<div class="bar"><i style=${`width:${Math.round(d.density * 100)}%;background:${d.c.color}`}></i></div></span>
          <span class="n">${d.n}<div class="tiny">${Math.round(d.density * 100)}% · ${d.shared} shared</div></span></button>`)}
      </div>

      <div class="net-card">
        <div class="net-h">Cities</div>
        ${Object.entries(ins.cities).sort((a, b) => b[1] - a[1]).map(([c, n]) => html`<div class="kv"><span><i class="dot" style=${`background:${CITY_COLOR[c] || "#9a8f86"}`}></i>${cityName(c)}</span><b>${n} <span class="tiny muted">${pct(n, ins.people)}</span></b></div>`)}
      </div>
    </aside>`}

    ${g && series && html`<div class="net-time">
      <button class="play" onClick=${() => setPlaying((p) => !p)} title=${playing ? "Pause" : "Replay the growth"}>${playing ? "❚❚" : "▶"}</button>
      <div class="track">
        <svg viewBox=${`0 0 ${series.weeks - 1} 40`} preserveAspectRatio="none">
          <path d=${areaPath(series.M, 40)} fill="#8b6cf0" opacity=".35" />
          <path d=${areaPath(series.X, 40)} fill="#f6ecdf" opacity=".35" />
          <path d=${areaPath(series.P, 40)} fill="#e85d75" opacity=".55" />
        </svg>
        <input type="range" min=${g.tMin} max=${g.tMax} step=${DAY / 4} value=${t} onInput=${(e) => { setPlaying(false); scrub(e.target.value); }} />
        <div class="ticks"><span>${fmtDate(g.tMin)}</span><span class="now">${fmtDate(t)}</span><span>today</span></div>
      </div>
      <div class="legend"><i style="background:#e85d75"></i>people <i style="background:#f6ecdf"></i>circles <i style="background:#8b6cf0"></i>memberships</div>
    </div>`}

    ${hover && !drag.current && html`<div class="net-tip" style=${`left:${hover.x + 14}px;top:${hover.y + 14}px`}>
      <b>${hover.node.kind === "c" ? hover.node.emoji + " " : ""}${hover.node.name}</b>
      <div>${hover.node.kind === "c"
        ? `${ins?.density.find((d) => d.c === hover.node)?.n ?? 0} members · ${cityName(hover.node.city)}`
        : `${ins?.commsOf.get(hover.node.id)?.size || 0} communities · circle of ${ins?.deg.get(hover.node.id) || 0} · ${cityName(hover.node.city)}`}</div>
      <div class="tiny">${hover.node.kind === "c" ? "created" : "joined"} ${fmtDate(hover.node.t0)} · click to focus</div>
    </div>`}
  </div>`;
}

const avatarSrc = (p) => (p.avatar_url.startsWith("http") ? p.avatar_url : `${window.CA_CONFIG?.SUPABASE_URL || ""}/storage/v1/object/public/avatars/${p.avatar_url}`);
function areaPath(arr, h) {
  const max = Math.max(1, ...arr), n = arr.length;
  let d = `M0 ${h}`;
  arr.forEach((v, i) => { d += ` L${i} ${(h - (v / max) * h).toFixed(2)}`; });
  return d + ` L${n - 1} ${h} Z`;
}
