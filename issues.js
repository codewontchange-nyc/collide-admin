import { useState, useMemo } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Page, Metrics, Pill, Avatar, Loading, Empty, LoadError, cityName, ago, sinceIso, TIME_WINDOWS, DAY, confirmDanger } from "./ui.js?v=__V__";
import { useLoader, COLS, showError } from "./db.js?v=__V__";

/* Issues — the app's telemetry (client_errors) reported for humans:
   summary metrics, then errors grouped sentry-style by normalized message +
   source (count, affected users, first/last seen, cities, versions). Click a
   group for the raw occurrences with stacks. Owners can clear handled
   groups. Staff-visible (RLS scopes reads to staff already). */

// collapse ids/numbers/uuids so "load failed for event 123" groups as one issue
const normalize = (msg) =>
  (msg || "(no message)")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "‹id›")
    .replace(/\d+/g, "‹n›")
    .slice(0, 160);
const CAP = 2000;

export function IssuesPage({ client, isOwner, flash }) {
  const [win, setWin] = useState("7d");
  const [q, setQ] = useState("");
  const [surface, setSurface] = useState("all");   // all | app | console
  const [open, setOpen] = useState(null);   // group key

  const { data, error, reload } = useLoader(async () => {
    const days = TIME_WINDOWS.find(([k]) => k === win)?.[1] || 7;
    const { data: rows, error: e } = await client.from("client_errors").select("*")
      .gte("created_at", sinceIso(days)).order("created_at", { ascending: false }).limit(CAP);
    if (e) return { error: e };
    const ids = [...new Set((rows || []).map((r) => r.profile_id).filter(Boolean))];
    const profs = ids.length ? await client.from("profiles").select(COLS.profileMin).in("id", ids) : { data: [] };
    return { data: { rows: rows || [], profiles: new Map((profs.data || []).map((p) => [p.id, p])) } };
  }, [client, win], { flash, where: "Issues" });
  const loading = data === null;
  const d = data && !Array.isArray(data) ? data : { rows: [], profiles: new Map() };

  const groups = useMemo(() => {
    const map = new Map();
    const scoped = surface === "all" ? d.rows
      : surface === "console" ? d.rows.filter((r) => (r.source || "").startsWith("console"))
      : d.rows.filter((r) => !(r.source || "").startsWith("console"));
    for (const r of scoped) {
      const key = (r.source || "app") + "|" + normalize(r.message);
      let g = map.get(key);
      if (!g) { g = { key, message: normalize(r.message), sample: r.message, source: r.source || "app",
        count: 0, users: new Set(), cities: new Set(), vers: new Set(), first: r.created_at, last: r.created_at, rows: [] }; map.set(key, g); }
      g.count++;
      if (r.profile_id) g.users.add(r.profile_id);
      if (r.city) g.cities.add(r.city);
      if (r.ver) g.vers.add(r.ver);
      if (r.created_at < g.first) g.first = r.created_at;
      if (r.created_at > g.last) g.last = r.created_at;
      if (g.rows.length < 25) g.rows.push(r);
    }
    let out = [...map.values()].sort((a, b) => (a.last < b.last ? 1 : -1));
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      out = out.filter((g) => (g.sample || "").toLowerCase().includes(n) || g.source.toLowerCase().includes(n));
    }
    return out;
  }, [d.rows, q, surface]);

  const day = new Date(Date.now() - DAY).toISOString();
  const capped = d.rows.length >= CAP;

  const clearGroup = async (g) => {
    if (!confirmDanger(`Clear "${g.message}" — ${g.count} occurrence${g.count === 1 ? "" : "s"}? This deletes the log rows.`)) return;
    const ids = d.rows.filter((r) => (r.source || "app") + "|" + normalize(r.message) === g.key).map((r) => r.id);
    const { data: gone, error: e } = await client.from("client_errors").delete().in("id", ids).select("id");
    if (e) { showError(flash, "Clear", e); return; }
    const n = (gone || []).length;
    flash(n ? `Cleared ${n} ✓` : "Nothing cleared — those rows aren't yours to remove");
    reload();
  };

  return html`<${Page} title="Issues" sub="telemetry from the app and this console, grouped"
    actions=${html`<button class="btn sm ghost" onClick=${reload}>↻ refresh</button>`}>
    <div class="dt-metrics">
      <${Metrics} size="sm" loading=${loading} items=${[
        ["errors", capped ? `${CAP}+` : d.rows.length],
        ["last 24h", d.rows.filter((r) => r.created_at > day).length],
        ["issues", groups.length],
        ["users hit", new Set(d.rows.map((r) => r.profile_id).filter(Boolean)).size],
      ]} />
      <div class="u-grow"></div>
      <input class="dt-search" placeholder="Search errors…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <div class="chips">
        ${[["all", "all"], ["app", "📱 app"], ["console", "🖥 console"]].map(([k, l]) =>
          html`<button class="chip" aria-pressed=${surface === k ? "true" : "false"} onClick=${() => setSurface(k)}>${l}</button>`)}
      </div>
      <div class="chips">
        ${TIME_WINDOWS.map(([k]) => html`<button class="chip" aria-pressed=${win === k ? "true" : "false"} onClick=${() => setWin(k)}>${k}</button>`)}
      </div>
    </div>

    ${error ? html`<${LoadError} what="errors" error=${error} onRetry=${reload} />`
      : loading ? html`<${Loading} />`
      : groups.length === 0 ? html`<${Empty}>No errors in this window — quiet skies 🕊️</${Empty}>`
      : groups.map((g) => html`<div class="inset iss-group" key=${g.key}>
        <div class="iss-head" onClick=${() => setOpen(open === g.key ? null : g.key)}>
          <span class="iss-count">${g.count}</span>
          <div class="u-grow">
            <div class="iss-msg">${g.sample || g.message}</div>
            <div class="iss-meta">
              <${Pill} tone=${g.source.startsWith("console") ? "brand" : "neutral"}>${g.source.startsWith("console") ? "🖥 " : "📱 "}${g.source}</${Pill}>
              ${g.users.size > 0 && html`<span>${g.users.size} user${g.users.size === 1 ? "" : "s"}</span>`}
              ${[...g.cities].map((c) => html`<span class="citychip" style="margin:0">${cityName(c)}</span>`)}
              ${[...g.vers].slice(0, 3).map((v) => html`<${Pill} tone="neutral" sm>${v}</${Pill}>`)}
              <span>first ${ago(g.first)} · last <b>${ago(g.last)}</b></span>
            </div>
          </div>
          ${isOwner && html`<button class="btn sm ghost" onClick=${(e) => { e.stopPropagation(); clearGroup(g); }}>Clear</button>`}
          <span class="muted">${open === g.key ? "▾" : "▸"}</span>
        </div>
        ${open === g.key && html`<div class="iss-rows">
          ${g.rows.map((r) => html`<div class="iss-row" key=${r.id}>
            <div class="iss-rowmeta">
              ${r.profile_id
                ? html`<${Avatar} profile=${d.profiles.get(r.profile_id) || { display_name: "?" }} size="sm" />
                  <b>${d.profiles.get(r.profile_id)?.display_name || "unknown user"}</b>`
                : html`<span class="muted">anonymous</span>`}
              <span class="muted">${ago(r.created_at)}</span>
              ${r.city && html`<span class="citychip" style="margin:0">${cityName(r.city)}</span>`}
              ${r.ver && html`<${Pill} tone="neutral" sm>${r.ver}</${Pill}>`}
              ${r.url && html`<span class="muted tiny u-ellipsis" style="max-width:280px">${r.url}</span>`}
            </div>
            ${r.stack && html`<pre class="iss-stack">${r.stack}</pre>`}
            ${r.ua && html`<div class="tiny muted">${r.ua}</div>`}
          </div>`)}
          ${g.count > g.rows.length && html`<div class="tiny muted" style="padding:6px 0">+ ${g.count - g.rows.length} more occurrence${g.count - g.rows.length === 1 ? "" : "s"} in this window</div>`}
        </div>`}
      </div>`)}
    ${capped && html`<p class="tiny muted">Showing the most recent ${CAP.toLocaleString()} — narrow the window for full accuracy.</p>`}
  </${Page}>`;
}
