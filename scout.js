import { useState, useMemo } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Page, Tabs, Metrics, Pill, Loading, Empty, LoadError, CITIES, cityName, DEFAULT_CITY, shortDate, niceTime, ago, todayStr, moneyExact, confirmDanger } from "./ui.js?v=__V__";
import { useLoader, callFn, countOf, showError } from "./db.js?v=__V__";
import { PAGE } from "./routes.js?v=__V__";

/* Scout — find it out there, bring it in here. Staff paste links or watch
   sources (iCal / RSS / JSON-LD listing pages); everything lands in one feed
   per city where it can be saved, dismissed or (owners) ingested as a
   city-wide "Collide pick". The `scout` edge function does the reading. */

const SOURCE_LABEL = { generic: "web", ics: "calendar", rss: "feed", jsonld_page: "listing" };
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const when = (r) => `${shortDate(r.start_date)}${r.start_time ? " · " + niceTime(r.start_time.slice(0, 5)) : " · time TBD"}`;
const price = (r) => r.price_min_cents == null ? null : r.price_min_cents === 0 ? "free" : r.price_max_cents && r.price_max_cents !== r.price_min_cents ? `${moneyExact(r.price_min_cents)}–${moneyExact(r.price_max_cents)}` : moneyExact(r.price_min_cents);
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

export function ScoutPage({ client, communities, isOwner, session, flash, sub, go }) {
  const tab = PAGE.scout.tabs.some(([k]) => k === sub && k) ? sub : "";
  const [city, setCity] = useState(localStorage.getItem("ca.scoutcity") || DEFAULT_CITY);
  const pickCity = (c) => { localStorage.setItem("ca.scoutcity", c); setCity(c); };
  const ctx = { client, communities, isOwner, session, flash, go, city };
  return html`<${Page} title="Scout" sub="find it out there, bring it in here"
    actions=${html`<select class="commselect" value=${city} onChange=${(e) => pickCity(e.target.value)} title="Which city's feed">
      ${CITIES.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>`}>
    <${Tabs} page="scout" current=${tab} go=${go} />
    ${tab === "paste" ? html`<${PasteTab} ...${ctx} />` : html`<${FindTab} ...${ctx} />`}
  </${Page}>`;
}

/* ---------- the feed ---------- */
function FindTab({ client, isOwner, flash, city, go }) {
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(plusDays(14));
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("new");   // new (new+saved) | saved | ingested | dismissed | all
  const [sel, setSel] = useState(new Set());

  const { data: rows, error, reload, setData } = useLoader(() => {
    let qq = client.from("scout_items").select("*").eq("city", city).gte("start_date", from).lte("start_date", to)
      .order("start_date").order("start_time", { nullsFirst: false }).limit(500);
    if (status === "new") qq = qq.in("status", ["new", "saved"]); else if (status !== "all") qq = qq.eq("status", status);
    return qq;
  }, [client, city, from, to, status], { flash, where: "Scout", client, realtime: [{ table: "scout_items", filter: `city=eq.${city}` }] });
  const { data: ingested7 } = useLoader(() => countOf(client, "scout_items", (x) => x.eq("city", city).gte("ingested_at", new Date(Date.now() - 7 * 864e5).toISOString())).then((r) => ({ data: [r.count], error: r.error })), [client, city], { flash: null, where: "Scout" });
  const { data: sourcesDue } = useLoader(() => countOf(client, "scout_sources", (x) => x.eq("city", city).eq("enabled", true)).then((r) => ({ data: [r.count], error: r.error })), [client, city], { flash: null, where: "Scout" });

  const shown = useMemo(() => {
    let out = rows || [];
    if (q.trim()) { const n = q.trim().toLowerCase(); out = out.filter((r) => [r.title, r.venue_name, r.organizer_name, r.description].some((s) => (s || "").toLowerCase().includes(n))); }
    return out;
  }, [rows, q]);
  const byId = useMemo(() => new Map((rows || []).map((r) => [r.id, r])), [rows]);

  const setStatusOf = async (ids, next) => {
    const { error: e } = await client.from("scout_items").update({ status: next }).in("id", ids);
    if (e) { showError(flash, "Update", e); return; }
    setData((rs) => rs.map((r) => (ids.includes(r.id) ? { ...r, status: next } : r)));
    setSel(new Set());
    flash(next === "dismissed" ? `Dismissed ${ids.length}` : next === "saved" ? "Saved for later" : "Back in the feed");
  };
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const loading = rows === null;
  const counts = { new: (rows || []).filter((r) => r.status === "new").length, saved: (rows || []).filter((r) => r.status === "saved").length };

  return html`<div>
    <${Metrics} size="sm" loading=${loading} items=${[
      ["new", counts.new], ["saved", counts.saved], ["ingested · 7d", ingested7 ? ingested7[0] : "…"], ["sources watching", sourcesDue ? sourcesDue[0] : "…"],
    ]} />
    <div class="u-row u-wrap" style="margin-bottom:12px">
      <input type="date" class="dt-search" style="width:auto" value=${from} onInput=${(e) => setFrom(e.target.value)} />
      <span class="muted tiny">to</span>
      <input type="date" class="dt-search" style="width:auto" value=${to} onInput=${(e) => setTo(e.target.value)} />
      <input class="dt-search" placeholder="Search titles, venues, organizers…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <div class="chips">
        ${[["new", "new"], ["saved", "saved"], ["ingested", "ingested"], ["dismissed", "dismissed"], ["all", "all"]].map(([k, l]) =>
          html`<button class="chip" aria-pressed=${status === k ? "true" : "false"} onClick=${() => setStatus(k)}>${l}</button>`)}
      </div>
      <div class="u-grow"></div>
      <button class="btn sm ghost" onClick=${() => go("scout/paste")}>+ Paste a link</button>
    </div>

    ${sel.size > 0 && html`<div class="inset u-row" style="margin-bottom:12px">
      <b>${sel.size} selected</b>
      <button class="btn sm ghost" onClick=${() => setStatusOf([...sel], "saved")}>Save</button>
      <button class="btn sm danger" onClick=${() => setStatusOf([...sel], "dismissed")}>Dismiss</button>
      <div class="u-grow"></div>
      <button class="btn link tiny" onClick=${() => setSel(new Set())}>clear</button>
    </div>`}

    ${error ? html`<${LoadError} what="the feed" error=${error} onRetry=${reload} />`
      : loading ? html`<${Loading} label="Reading the feed…" />`
      : shown.length === 0 ? html`<${Empty}>${(rows || []).length ? "Nothing matches." : `Nothing in ${cityName(city)} for these dates yet — paste a link, or add a source to watch.`}</${Empty}>`
      : html`<div class="evlist">${shown.map((r) => html`<${ItemCard} key=${r.id} r=${r} byId=${byId} selected=${sel.has(r.id)} onToggle=${() => toggle(r.id)}
          onSave=${() => setStatusOf([r.id], r.status === "saved" ? "new" : "saved")} onDismiss=${() => setStatusOf([r.id], "dismissed")}
          onRestore=${() => setStatusOf([r.id], "new")} isOwner=${isOwner} go=${go} />`)}</div>`}
  </div>`;
}

function ItemCard({ r, byId, selected, onToggle, onSave, onDismiss, onRestore, isOwner, go }) {
  const dupe = r.dupe_of ? byId.get(r.dupe_of) : null;
  const p = price(r);
  return html`<div class=${"evcard scout-card" + (selected ? " selected" : "") + (r.status === "dismissed" ? " off" : "")}>
    <input type="checkbox" class="scout-check" checked=${selected} onChange=${onToggle} aria-label="Select" />
    ${r.image_url ? html`<img class="thumb" src=${r.image_url} alt="" loading="lazy" referrerpolicy="no-referrer" />` : html`<div class="thumb">🗓️</div>`}
    <div class="u-grow">
      <div class="t">${r.title}
        <${Pill} tone="neutral" sm title=${r.url}>${SOURCE_LABEL[r.source] || r.source} · ${host(r.url)}</${Pill}>
        ${p && html` <${Pill} tone="neutral" sm>${p}</${Pill}>`}
        ${r.status !== "new" && html` <${Pill} sm tone=${r.status === "ingested" ? "ok" : r.status === "saved" ? "warn" : "neutral"}>${r.status}</${Pill}>`}
      </div>
      <div class="d">${when(r)}${r.venue_name ? " · 📍 " + r.venue_name : r.address ? " · 📍 " + r.address : ""}${r.organizer_name ? " · " + r.organizer_name : ""}</div>
      ${r.description && html`<div class="tiny muted u-ellipsis" style="max-width:720px">${r.description}</div>`}
      ${dupe && html`<div class="tiny tone-warn">${dupe.status === "ingested" ? "already in Collide" : "same as"} “${dupe.title}” via ${SOURCE_LABEL[dupe.source] || dupe.source}</div>`}
    </div>
    <div class="rowactions">
      <a class="btn sm ghost" href=${r.url} target="_blank" rel="noopener" title="Open the source page">↗</a>
      ${r.status === "dismissed" ? html`<button class="btn sm ghost" onClick=${onRestore}>Restore</button>`
        : r.status === "ingested" ? html`<button class="btn sm ghost" onClick=${() => go("map")}>On the map</button>`
        : html`<button class="btn sm ghost" onClick=${onSave}>${r.status === "saved" ? "Unsave" : "Save"}</button>
          <button class="btn sm danger" onClick=${onDismiss}>Dismiss</button>`}
    </div>
  </div>`;
}

/* ---------- paste a link ---------- */
function PasteTab({ client, flash, city, isOwner, go }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);   // { items, method, error, partial }

  const run = async (ai = false) => {
    const u = url.trim(); if (!u) return;
    setBusy(true); setRes(null);
    const r = await callFn(client, "scout", { mode: "extract", url: u, city, ai, force: ai });
    setBusy(false);
    if (r.error) { setRes({ error: r.error }); return; }
    setRes(r.data);
    if (r.data.items?.length) flash(`${r.data.items.length} event${r.data.items.length === 1 ? "" : "s"} added to the ${cityName(city)} feed`);
  };
  const METHOD = { jsonld: "structured data on the page", og: "the page's preview tags", ics: "a calendar feed", claude: "read by Claude", "claude+og": "read by Claude", cached: "read a moment ago" };

  return html`<div class="reading">
    <p class="tiny muted" style="margin:0 0 10px">Any public event page works — Luma, Eventbrite, Partiful, a venue's site. Structured data is read first; Claude only reads the page when there's no date to be found.</p>
    <form class="u-row" onSubmit=${(e) => { e.preventDefault(); run(false); }}>
      <input class="dt-search u-grow" placeholder="https://lu.ma/… or any event link" value=${url} onInput=${(e) => setUrl(e.target.value)} />
      <button class="btn" disabled=${busy || !url.trim()}>${busy ? "Reading…" : "Extract"}</button>
    </form>
    ${res?.error && html`<${Empty} mt>${res.error === "no_date" ? html`Couldn't find a date on that page.${res.partial?.title ? html` It looks like <b>${res.partial.title}</b>.` : ""} <button class="btn sm" onClick=${() => run(true)}>Read it with Claude</button>` : res.error === "not_event" ? "That page doesn't describe a single event." : res.error}</${Empty}>`}
    ${res && !res.error && html`<div class="u-mt-1">
      <div class="tiny muted" style="margin-bottom:8px">Read from ${METHOD[res.method] || res.method}${res.method !== "claude" && res.method !== "claude+og" ? html` · <button class="btn link tiny" onClick=${() => run(true)}>re-read with Claude</button>` : ""}</div>
      ${res.items.length === 0 ? html`<${Empty}>No upcoming events on that page.</${Empty}>` : res.items.map((r) => html`<${PreviewCard} key=${r.id} r=${r} client=${client} flash=${flash} />`)}
      <p class="tiny muted u-mt-1">It's in the <button class="btn link tiny" onClick=${() => go("scout")}>feed</button> now${isOwner ? " — ingest arrives in the next release" : ""}.</p>
    </div>`}
  </div>`;
}

// what was read, with the fields an admin most often needs to correct
function PreviewCard({ r, client, flash }) {
  const [f, setF] = useState({ title: r.title, start_date: r.start_date, start_time: (r.start_time || "").slice(0, 5), venue_name: r.venue_name || "", address: r.address || "" });
  const [dirty, setDirty] = useState(false);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setDirty(true); };
  const save = async () => {
    const { error } = await client.from("scout_items").update({ title: f.title.trim(), start_date: f.start_date, start_time: f.start_time || null, venue_name: f.venue_name.trim() || null, address: f.address.trim() || null }).eq("id", r.id);
    if (error) showError(flash, "Save", error); else { flash("Saved ✓"); setDirty(false); }
  };
  return html`<div class="inset scout-preview">
    ${r.image_url && html`<img src=${r.image_url} alt="" referrerpolicy="no-referrer" />`}
    <div class="u-grow">
      <div class="field"><label>Title</label><input value=${f.title} onInput=${set("title")} /></div>
      <div class="fieldrow">
        <div class="field"><label>Date</label><input type="date" value=${f.start_date} onInput=${set("start_date")} /></div>
        <div class="field"><label>Time</label><input type="time" value=${f.start_time} onInput=${set("start_time")} /></div>
      </div>
      <div class="fieldrow">
        <div class="field"><label>Venue</label><input value=${f.venue_name} onInput=${set("venue_name")} placeholder="Where" /></div>
        <div class="field"><label>Address</label><input value=${f.address} onInput=${set("address")} /></div>
      </div>
      <div class="tiny muted">${[price(r), r.organizer_name, r.lat != null ? "geocoded" : null, r.description ? r.description.slice(0, 160) + (r.description.length > 160 ? "…" : "") : null].filter(Boolean).join(" · ")}</div>
      <div class="u-row u-mt-1"><a class="btn sm ghost" href=${r.url} target="_blank" rel="noopener">open source ↗</a>${dirty && html`<button class="btn sm" onClick=${save}>Save edits</button>`}</div>
    </div>
  </div>`;
}
