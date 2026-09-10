import { h } from "https://esm.sh/preact@10.23.2";
import htm from "https://esm.sh/htm@3.1.1";
import { useEffect, useRef, useMemo } from "https://esm.sh/preact@10.23.2/hooks";
import { storageUrl, BUCKETS, paged } from "./db.js?v=__V__";
import { PAGE, go as goRoute } from "./routes.js?v=__V__";

export const html = htm.bind(h);
export { paged as fetchAll };   // older name, same helper

/* ---------- constants ---------- */
export const DAY = 864e5;
export const DEFAULT_CITY = "nyc";

/* city roster — mirrors the app's map cities (nyc live, others being inked) */
export const CITIES = [
  ["nyc", "New York"], ["atl", "Atlanta"], ["la", "Los Angeles"], ["chi", "Chicago"],
  ["sf", "San Francisco"], ["nola", "New Orleans"], ["dc", "Washington DC"],
];
export const cityName = (id) => (CITIES.find(([k]) => k === id)?.[1] || id || "—");

// The only hex JS is allowed to hold — for canvas, SVG and html2canvas output
// where CSS variables can't reach. Everything on-screen uses the CSS tokens.
export const BRAND = {
  ink: "#241d1a", ink2: "#5c534d", muted: "#6f645b", faint: "#c9bfb4", line: "#ece1d5",
  paper: "#fbf6f0", surface: "#ffffff", surface2: "#f5ece2",
  rose: "#e85d75", roseInk: "#b03450", roseSoft: "#fbe7ec",
  teal: "#18857a", tealBright: "#2fb3a5", tealInk: "#0f5d55", tealSoft: "#e2f0ee",
  amber: "#f0a830", amberInk: "#8a6116", amberSoft: "#faeed3",
  blue: "#4c9be8", purple: "#8b6cf0", danger: "#d2402f", white: "#ffffff",
  darkPaper: "#150f0c", darkSurface: "#2a211c", darkInk: "#fbf6f0",
};
export const CATEGORICAL = [BRAND.rose, BRAND.tealBright, BRAND.amber, BRAND.purple, BRAND.blue, "#7cc242", "#f27d3a", "#e6c14a", "#d95bb6", "#39c2d7", "#a3e078", "#ff8fa3"];
export const CITY_COLOR = { nyc: BRAND.rose, atl: BRAND.tealBright, la: BRAND.amber, chi: BRAND.blue, sf: BRAND.purple, nola: "#f27d3a", dc: "#39c2d7", global: BRAND.amber };
export const cityColor = (id) => CITY_COLOR[id] || BRAND.faint;
// the city a row inherits from its community (members only see their city's posts)
export const stampCity = (communities, communityId) => (communities || []).find((c) => c.id === communityId)?.city || DEFAULT_CITY;

export const EVENT_CATEGORIES = [
  { key: "food", label: "🍽️ Food" }, { key: "coffee", label: "☕ Coffee" },
  { key: "drinks", label: "🍸 Drinks" }, { key: "active", label: "🏃 Active" },
  { key: "walk", label: "🌙 Walk" }, { key: "chill", label: "🛋️ Chill" }, { key: "other", label: "✨ Other" },
];
export const EV_CATS = EVENT_CATEGORIES.map((c) => c.key);
export const TIME_WINDOWS = [["24h", 1], ["7d", 7], ["30d", 30], ["all", 3650]];

/* ---------- time ---------- */
// Dates arrive as "YYYY-MM-DD" (a calendar day → local midnight) or as ISO
// timestamps. Never `new Date("2026-09-09")` — that's UTC and shifts a day west.
export const parseDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(typeof v === "string" && v.length === 10 ? v + "T00:00:00" : v);
  return isNaN(d) ? null : d;
};
const loc = (d, opts) => d.toLocaleDateString(undefined, opts);
export const shortDate = (v) => { const d = parseDate(v); return d ? loc(d, { month: "short", day: "numeric", year: "2-digit" }) : "—"; };
export const fullDate = (v) => { const d = parseDate(v); return d ? loc(d, { month: "short", day: "numeric", year: "numeric" }) : "—"; };
export const shortDateTime = (v) => { const d = parseDate(v); return d ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"; };
export const timeOf = (v) => { const d = parseDate(v); return d ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—"; };
export const timeRange = (a, b) => { const s = parseDate(a), e = parseDate(b); if (!s) return "—";
  return `${loc(s, { weekday: "short", month: "short", day: "numeric" })} · ${timeOf(s)}${e ? "–" + timeOf(e) : ""}`; };
export const niceDate = (iso) => { const d = parseDate(iso); return d ? loc(d, { weekday: "long", month: "short", day: "numeric" }) : (iso || ""); };
export const niceTime = (t) => {
  if (!t) return "";
  const [hh, mm] = t.split(":").map(Number);
  const ap = hh >= 12 ? "pm" : "am";
  const h12 = ((hh + 11) % 12) + 1;
  return mm ? `${h12}:${String(mm).padStart(2, "0")}${ap}` : `${h12}${ap}`;
};
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayStr = () => ymd(new Date());
export const daysAgoStr = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
export const monthStartStr = () => { const d = new Date(); d.setDate(1); return ymd(d); };   // local, not UTC
export const sinceIso = (days) => new Date(Date.now() - days * DAY).toISOString();

// relative time, three flavours — all null-safe (no more "NaNm ago")
export const ago = (v) => {
  const d = parseDate(v); if (!d) return "—";
  const s = Math.max(0, (Date.now() - d) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
export const agoDay = (v) => {
  const d = parseDate(v); if (!d) return "never";
  const n = Math.floor((Date.now() - d) / DAY);
  return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n}d ago`;
};
export const left = (v) => {
  const d = parseDate(v); if (!d) return "";
  const ms = d - Date.now();
  if (ms <= 0) return "expired";
  if (ms < 3600e3) return `${Math.ceil(ms / 60e3)}m left`;
  if (ms < DAY) return `${Math.ceil(ms / 3600e3)}h left`;
  return `${Math.ceil(ms / DAY)}d left`;
};
export const isExpired = (x) => { const iso = typeof x === "string" ? x : x?.expires_at; return !!iso && new Date(iso).getTime() < Date.now(); };

// the app's Plan-something buckets + the mirror fields the mobile app renders
export const whenBucket = (dateStr) => {
  const days = Math.round((parseDate(dateStr) - new Date(new Date().toDateString())) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  const dow = parseDate(dateStr).getDay();
  if (days <= 7) return (dow === 0 || dow >= 5) ? "this_weekend" : "this_week";
  if (days <= 14) return "next_week";
  return "someday";
};
export const dateExpiry = (dateStr) => new Date(new Date(dateStr + "T23:59:00").getTime() + DAY).toISOString();
export const eventMirror = ({ date, starts_at, location }) => ({
  place: location || null,
  at_time: starts_at ? niceTime(starts_at) : null,
  when_bucket: date ? whenBucket(date) : null,
  expires_at: date ? dateExpiry(date) : null,
});

/* ---------- numbers ---------- */
export const money = (cents) => "$" + (Math.round((cents || 0) / 100)).toLocaleString("en-US");
export const moneyExact = (cents) => "$" + ((cents || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: (cents || 0) % 100 ? 2 : 0 });
export const toCents = (v) => Math.round(parseFloat(v || "0") * 100) || 0;
export const pct = (n, d) => (d ? Math.round((n / d) * 100) + "%" : "—");

/* ---------- people ---------- */
export const initials = (name) => (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
export const avatarSrc = (profile) => storageUrl(BUCKETS.avatars, profile?.avatar_url);
const HUES = [BRAND.rose, BRAND.tealBright, "#b9852e", BRAND.purple, BRAND.blue, "#588c3f"];
export const hueFor = (name) => HUES[((name || "?").charCodeAt(0) || 0) % HUES.length];
export function Avatar({ profile, size = "" }) {
  const name = profile?.display_name || "?";
  const src = avatarSrc(profile);
  const cls = typeof size === "number" ? "" : size;
  const style = typeof size === "number" ? `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px` : "";
  if (src) return html`<img class=${"avatar " + cls} style=${style} src=${src} alt=${name} title=${name} />`;
  return html`<span class=${"avatar ph " + cls} style=${`background:${hueFor(name)};${style}`} title=${name}>${name[0].toUpperCase()}</span>`;
}

// one word → one tone, so every page colours the same state the same way
export const statusTone = (s) => {
  const w = String(s || "").toLowerCase();
  if (["member", "accepted", "going", "confirmed", "open", "active", "live", "published", "paid", "ok", "signed in"].includes(w)) return "ok";
  if (["pending", "draft", "awaiting", "trialing", "invited", "requested", "paused"].includes(w)) return "warn";
  if (["cancelled", "canceled", "declined", "banned", "hidden", "removed", "past_due", "unpaid", "failed", "error"].includes(w)) return "bad";
  if (["owner", "facilitator", "staff", "maker", "host"].includes(w)) return "brand";
  return "neutral";
};

/* ---------- components ---------- */
export const Pill = ({ tone, sm, title, children }) =>
  html`<span class=${"pill " + (tone || statusTone(children)) + (sm ? " sm" : "")} title=${title}>${children}</span>`;

export const Loading = ({ label = "Loading…" }) => html`<div class="empty bare">${label}</div>`;
export const Empty = ({ bare, span, mt, onClick, children }) =>
  html`<div class=${"empty" + (bare ? " bare" : "") + (span ? " span" : "") + (mt ? " mt" : "")} onClick=${onClick} style=${onClick ? "cursor:pointer" : ""}>${children}</div>`;
export const LoadError = ({ what = "this", error, onRetry }) =>
  html`<div class="empty bad"><span>Couldn't load ${what}${error ? ": " + error : ""}</span>${onRetry && html`<button class="btn sm ghost" onClick=${onRetry}>Retry</button>`}</div>`;

// Page shell: <Page title="Money" sub="every dollar" actions=${html`<button …>`}>…</Page>
export function Page({ title, sub, actions, card = true, reading, className = "", children }) {
  const cls = "page" + (card ? " card" : "") + (reading ? " reading" : "") + (className ? " " + className : "");
  return html`<div class=${cls}>
    ${(title || actions) && html`<div class="pagehead">
      <h2>${title}${sub && html` <span class="sub">${sub}</span>`}</h2>
      ${actions && html`<div class="u-row">${actions}</div>`}
    </div>`}
    ${children}
  </div>`;
}

// Sub-navigation for a page's tabs, from the route table
export function Tabs({ page, current, go = goRoute, children }) {
  const tabs = PAGE[page]?.tabs || [];
  return html`<div class="tabs"><div class="subnav">
    ${children}
    ${tabs.map(([k, label]) => html`<button class=${(current || "") === k ? "on" : ""} aria-current=${(current || "") === k ? "page" : undefined}
      onClick=${() => go(k ? page + "/" + k : page)}>${label}</button>`)}
  </div></div>`;
}

// KPI tiles: items = [[label, value, { money, tone, sub }]]
export function Metrics({ items, loading, size = "", className = "" }) {
  return html`<div class=${"metrics " + size + " " + className}>
    ${items.map(([label, value, o = {}]) => html`<div class=${"metric" + (o.tone ? " tone-" + o.tone : "")}>
      <div class="l">${label}</div>
      <div class=${"n" + (o.money ? " money" : "")}>${loading ? "…" : value}</div>
      ${o.sub && html`<div class="sub">${loading ? "" : o.sub}</div>`}
    </div>`)}
  </div>`;
}

// Modal — a real dialog: labelled, Escape closes, Tab stays inside, focus returns.
export function Modal({ title, onClose, width, children }) {
  const ref = useRef(null);
  const id = useMemo(() => "dlg-" + Math.random().toString(36).slice(2, 7), []);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const prev = document.activeElement;
    const focusables = () => [...el.querySelectorAll('input,select,textarea,button,[href],[contenteditable],[tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled);
    (focusables()[0] || el).focus();
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose?.(); return; }
      if (e.key !== "Tab") return;
      const f = focusables(); if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    };
    el.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { el.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, []);
  return html`<div class="overlay" onClick=${(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
    <div class="modal" ref=${ref} role="dialog" aria-modal="true" aria-labelledby=${id} tabIndex="-1" style=${width ? `width:${width}px` : ""}>
      <h3 id=${id}>${title}</h3>${children}
    </div>
  </div>`;
}
// the destructive-action gates, in one place so they can grow into real dialogs later
export const confirmDanger = (msg) => window.confirm(msg);
export const promptReason = (msg, def = "") => window.prompt(msg, def);

/* ---------- storage helpers (event-media bucket) ---------- */
export function mediaUrl(client, path) {
  if (!path) return null;
  try { return client.storage.from(BUCKETS.media).getPublicUrl(path).data.publicUrl; }
  catch { return null; }
}
export async function uploadMedia(client, prefix, file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await client.storage.from(BUCKETS.media).upload(path, file, { contentType: file.type || "image/jpeg", upsert: true });
  if (error) throw error;
  return path;
}
