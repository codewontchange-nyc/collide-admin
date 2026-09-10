import { useState, useMemo, useEffect, useRef } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Page, Tabs, Metrics, Pill, Modal, Loading, Empty, LoadError, CITIES, cityName, DEFAULT_CITY, shortDate, niceTime, ago, todayStr, moneyExact, EVENT_CATEGORIES, confirmDanger } from "./ui.js?v=__V__";
import { useLoader, callFn, countOf, showError, storageUrl, BUCKETS } from "./db.js?v=__V__";
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
function FindTab({ client, isOwner, flash, city, go, communities }) {
  const [ingesting, setIngesting] = useState(null);   // [items] queued for the Ingest window
  const [epoch, setEpoch] = useState(0);              // bumps the side counters after a publish
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
  const { data: ingested7 } = useLoader(() => countOf(client, "scout_items", (x) => x.eq("city", city).gte("ingested_at", new Date(Date.now() - 7 * 864e5).toISOString())).then((r) => ({ data: [r.count], error: r.error })), [client, city, epoch], { flash: null, where: "Scout" });
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
      ${isOwner && html`<button class="btn sm" onClick=${() => setIngesting([...sel].map((id) => byId.get(id)).filter((r) => r && r.status !== "ingested"))}>Ingest ${sel.size}…</button>`}
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
          onRestore=${() => setStatusOf([r.id], "new")} onIngest=${() => setIngesting([r])} isOwner=${isOwner} go=${go} />`)}</div>`}
    ${ingesting && ingesting.length > 0 && html`<${IngestModal} client=${client} items=${ingesting} communities=${communities} flash=${flash} go=${go}
      onClose=${() => setIngesting(null)} onDone=${() => { setIngesting(null); setSel(new Set()); setEpoch((e) => e + 1); reload(); }} />`}
  </div>`;
}

function ItemCard({ r, byId, selected, onToggle, onSave, onDismiss, onRestore, onIngest, isOwner, go }) {
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
        : html`${isOwner && html`<button class="btn sm" onClick=${onIngest}>Ingest</button>`}
          <button class="btn sm ghost" onClick=${onSave}>${r.status === "saved" ? "Unsave" : "Save"}</button>
          <button class="btn sm danger" onClick=${onDismiss}>Dismiss</button>`}
    </div>
  </div>`;
}

/* ---------- paste a link ---------- */
function PasteTab({ client, flash, city, isOwner, go, communities }) {
  const [ingesting, setIngesting] = useState(null);
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
      ${res.items.length === 0 ? html`<${Empty}>No upcoming events on that page.</${Empty}>` : res.items.map((r) => html`<${PreviewCard} key=${r.id} r=${r} client=${client} flash=${flash} onIngest=${isOwner && r.status !== "ingested" ? () => setIngesting([r]) : null} />`)}
      <p class="tiny muted u-mt-1">It's in the <button class="btn link tiny" onClick=${() => go("scout")}>feed</button> now.</p>
    </div>`}
    ${ingesting && html`<${IngestModal} client=${client} items=${ingesting} communities=${communities} flash=${flash} go=${go}
      onClose=${() => setIngesting(null)} onDone=${() => { setIngesting(null); run(false); }} />`}
  </div>`;
}

// what was read, with the fields an admin most often needs to correct
function PreviewCard({ r, client, flash, onIngest }) {
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
      <div class="u-row u-mt-1"><a class="btn sm ghost" href=${r.url} target="_blank" rel="noopener">open source ↗</a>${dirty && html`<button class="btn sm ghost" onClick=${save}>Save edits</button>`}${onIngest && html`<button class="btn sm" onClick=${onIngest}>Ingest…</button>`}${r.status === "ingested" && html`<${Pill} tone="ok">in Collide</${Pill}>`}</div>
    </div>
  </div>`;
}

/* ---------- ingest: preview → place on the map → publish ----------
   One item at a time (bulk steps through). City-wide picks need a dot on
   the hand-drawn map before they exist for members, so the map is the
   heart of this window; attaching a community skips it (the community's
   own pin takes over). */
function IngestModal({ client, items, communities, flash, go, onClose, onDone }) {
  const [idx, setIdx] = useState(0);
  const item = items[idx];
  const total = items.length;
  const [f, setF] = useState({ community_id: "", category: "", note: null, use_image: true, x: null, y: null });
  const [pre, setPre] = useState(null);   // dry-run: { row, place, warnings }
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState([]);
  const box = useRef(null);

  useEffect(() => {   // fresh preview per item
    let live = true; setPre(null);
    setF({ community_id: "", category: "", note: null, use_image: true, x: null, y: null });
    callFn(client, "scout", { mode: "ingest", item_id: item.id, dry: true }).then((r) => {
      if (!live) return;
      if (r.error) { setPre({ error: r.error }); return; }
      setPre(r.data);
      setF((p) => ({ ...p, category: r.data.row.category, x: r.data.place?.x ?? null, y: r.data.place?.y ?? null }));
    });
    return () => { live = false; };
  }, [item.id]);

  const { data: art } = useLoader(async () => {
    const [cfg, c] = await Promise.all([client.from("map_config").select("image_path").eq("city", item.city).maybeSingle(), client.from("cities").select("map_image_path").eq("code", item.city).maybeSingle()]);
    return cfg.error ? { error: cfg.error } : { data: { path: cfg.data?.image_path || c.data?.map_image_path || null } };
  }, [client, item.city], { flash: null, where: "Ingest" });
  const img = art && !Array.isArray(art) ? storageUrl(BUCKETS.map, art.path) : null;
  const placeAt = (ev) => {
    const r = box.current.querySelector("img").getBoundingClientRect();
    setF({ ...f, x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)) });
  };
  const needsPin = !f.community_id;
  const canGo = pre && !pre.error && !busy && (!needsPin || (f.x != null && f.y != null));

  const publish = async () => {
    setBusy(true);
    const r = await callFn(client, "scout", { mode: "ingest", item_id: item.id, community_id: f.community_id || null, category: f.category,
      note: f.note, use_image: f.use_image, ...(needsPin ? { x: f.x, y: f.y } : {}) });
    setBusy(false);
    if (r.error) { showError(flash, "Ingest", r.error === "unplaced" ? "Place it on the map first" : r.error); return; }
    const next = [...done, { id: item.id, activity_id: r.data.activity_id, pin_id: r.data.pin_id }];
    setDone(next);
    flash(`Live in the app ✨ (${next.length}/${total})`);
    if (idx + 1 < total) setIdx(idx + 1); else onDone(next);
  };
  const skip = () => { if (idx + 1 < total) setIdx(idx + 1); else onDone(done); };

  return html`<${Modal} title=${`Ingest${total > 1 ? ` · ${idx + 1} of ${total}` : ""} — ${item.title}`} width=${1080} onClose=${() => { if (!busy) (done.length ? onDone(done) : onClose()); }}>
    ${pre?.error ? html`<${Empty}>${pre.error}</${Empty}>` : !pre ? html`<${Loading} label="Checking…" />` : html`
      ${pre.warnings?.length > 0 && html`<div class="inset" style="border:1px solid var(--warn);margin-bottom:12px"><b class="tone-warn">Looks like it might already be in Collide:</b> ${pre.warnings.map((w) => w.title).join(" · ")} — ingest anyway if it's a different plan.</div>`}
      <div class="stops-grid">
        <div>
          ${needsPin ? html`
            <div class="tiny muted" style="margin-bottom:6px">${f.x != null ? (pre.place?.origin?.startsWith("poi") && f.x === pre.place.x ? `Placed from the POI “${pre.place.origin.slice(5)}” — drag or click to adjust.` : "Placed. Click to move it.") : "City-wide picks show up for members only once they're on the map — click where it happens."}</div>
            <div class=${"stops-map" + (f.x == null ? " placing" : "")} ref=${box} onClick=${placeAt}>
              ${img ? html`<img src=${img} alt="" draggable=${false} />
                ${f.x != null && html`<span class="stop-dot" style=${`left:${f.x * 100}%;top:${f.y * 100}%`}>${EVENT_CATEGORIES.find((c) => c.key === f.category)?.label.split(" ")[0] || "✨"}</span>`}`
                : art === null ? html`<${Loading} label="Loading map…" />` : html`<${Empty}>No ${cityName(item.city)} artwork yet — upload it on the Map page first.</${Empty}>`}
            </div>`
            : html`<div class="inset"><b>${communities.find((c) => c.id === f.community_id)?.name}</b> members will see this in their community; its pin lands beside the community's own on the map.</div>`}
        </div>
        <div class="u-col" style="gap:10px">
          <div class="inset">
            <div><b>${pre.row.title}</b></div>
            <div class="tiny muted">${shortDate(pre.row.date)}${pre.row.at_time ? " · " + pre.row.at_time : ""}${pre.row.location ? " · 📍 " + pre.row.location : ""}${pre.row.price_cents ? " · " + moneyExact(pre.row.price_cents) : ""}</div>
            <div class="tiny muted u-mt-1">${pre.row.note}</div>
          </div>
          <div class="field"><label>Community <span class="muted">(optional — leave empty for a city-wide pick)</span></label>
            <select value=${f.community_id} onChange=${(e) => setF({ ...f, community_id: e.target.value })}>
              <option value="">🌍 City-wide pick · ${cityName(item.city)}</option>
              ${communities.filter((c) => !c.archived_at && (c.city === item.city || c.city === "global")).map((c) => html`<option value=${c.id}>${c.emoji || ""} ${c.name}</option>`)}
            </select></div>
          <div class="field"><label>Category</label>
            <div class="chips">${EVENT_CATEGORIES.map((c) => html`<button type="button" class="chip" aria-pressed=${f.category === c.key ? "true" : "false"} onClick=${() => setF({ ...f, category: c.key })}>${c.label}</button>`)}</div></div>
          <div class="field"><label>Note <span class="muted">(what members read)</span></label>
            <textarea rows="3" value=${f.note ?? pre.row.note} onInput=${(e) => setF({ ...f, note: e.target.value })}></textarea></div>
          ${item.image_url && html`<label class="crm-toggle"><input type="checkbox" checked=${f.use_image} onChange=${(e) => setF({ ...f, use_image: e.target.checked })} /> <span>use the source image</span> <img src=${item.image_url} alt="" referrerpolicy="no-referrer" style="height:28px;border-radius:5px;margin-left:6px" /></label>`}
          <div class="tiny muted">Hosted by <b>Collide</b> · links back to ${host(item.url)}</div>
        </div>
      </div>
      <div class="actions" style="justify-content:space-between">
        <div class="u-row">${total > 1 && html`<button type="button" class="btn ghost" disabled=${busy} onClick=${skip}>Skip</button>`}</div>
        <div class="u-row">
          <button type="button" class="btn ghost" disabled=${busy} onClick=${() => (done.length ? onDone(done) : onClose())}>${done.length ? "Done" : "Cancel"}</button>
          <button type="button" class="btn" disabled=${!canGo} title=${needsPin && f.x == null ? "Click the map to place it first" : ""} onClick=${publish}>${busy ? "Publishing…" : "Publish to the app"}</button>
        </div>
      </div>`}
  </${Modal}>`;
}
