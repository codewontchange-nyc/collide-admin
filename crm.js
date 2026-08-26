import { useState, useEffect, useMemo, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Avatar, cityName } from "./ui.js?v=12";

/* CRM — watch users move down the maturity funnel and run the drip engine.
   Funnel: stages derived live from real actions (crm_users RPC). Campaigns:
   the editable drip steps. Activity: every touch the engine sent, plus
   run-now / preview controls. Owner-only, like Data. */

const TABS = [["funnel", "Funnel"], ["campaigns", "Campaigns"], ["activity", "Activity"]];
const STAGES = [
  [1, "Signed up", "hasn't joined or RSVP'd yet"],
  [2, "Joined & RSVP'd", "in a community or on a roster"],
  [3, "In a circle", "connected, hasn't yapped"],
  [4, "Yapping", "fully activated 🎓"],
];
const CHANNELS = ["push", "email", "both"];

const ago = (iso) => {
  if (!iso) return "never";
  const d = Math.floor((Date.now() - new Date(iso)) / 864e5);
  return d === 0 ? "today" : d === 1 ? "1d ago" : `${d}d ago`;
};
const daysIn = (iso) => Math.floor((Date.now() - new Date(iso)) / 864e5);

/* invoke crm-tick with the caller's staff JWT */
async function runEngine(client, dry) {
  const { data, error } = await client.functions.invoke("crm-tick", { body: { dry } });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* generic */ }
    return { error: msg };
  }
  return data;
}

function FunnelBoard({ users }) {
  const reached = (n) => users.filter((u) => u.stage >= n).length;
  return html`<div class="crm-cols">
    ${STAGES.map(([n, label, hint]) => {
      const here = users.filter((u) => u.stage === n)
        .sort((a, b) => new Date(a.stage_entered_at) - new Date(b.stage_entered_at));
      const conv = n < 4 && reached(n) > 0 ? Math.round(reached(n + 1) / reached(n) * 100) : null;
      return html`<div class="crm-col card" key=${n}>
        <div class="crm-colhead">
          <div><span class="crm-stageno">${n}</span> <b>${label}</b></div>
          <div class="crm-count">${here.length}</div>
        </div>
        <div class="tiny muted" style="margin-bottom:8px">${hint}${conv != null && html` · <b style="color:var(--teal-ink)">${conv}%</b> advance`}</div>
        ${here.map((u) => html`<div class="crm-user" key=${u.id}>
          <${Avatar} profile=${u} size="sm" />
          <div style="flex:1;min-width:0">
            <div class="n">${u.display_name || u.email || "—"}${u.is_staff && html` <span class="pillstat facilitator" style="font-size:9.5px">staff</span>`}${u.opt_out && html` <span class="pillstat" style="font-size:9.5px">opted out</span>`}</div>
            <div class="d">${daysIn(u.stage_entered_at)}d in stage · ${u.touches > 0 ? `${u.touches} touch${u.touches === 1 ? "" : "es"}, last ${ago(u.last_touch_at)}` : "untouched"}</div>
          </div>
        </div>`)}
        ${here.length === 0 && html`<div class="tiny muted" style="padding:8px 0">Nobody here.</div>`}
      </div>`;
    })}
  </div>`;
}

function CampaignsTab({ client, flash }) {
  const [rows, setRows] = useState(null);
  const load = useCallback(async () => {
    const { data } = await client.from("crm_campaigns").select("*").order("stage").order("step");
    setRows(data || []);
  }, [client]);
  useEffect(() => { load(); }, [load]);

  const save = async (r, patch) => {
    const { error } = await client.from("crm_campaigns").update(patch).eq("id", r.id);
    if (error) flash(error.message);
    else setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, ...patch } : x)));
  };
  const del = async (r) => {
    if (!confirm(`Delete step ${r.step} of stage ${r.stage}? Its send history stays.`)) return;
    const { error } = await client.from("crm_campaigns").delete().eq("id", r.id);
    if (error) flash(error.message); else { flash("Step deleted"); load(); }
  };
  const add = async (stage) => {
    const step = Math.max(0, ...(rows || []).filter((r) => r.stage === stage).map((r) => r.step)) + 1;
    const { error } = await client.from("crm_campaigns").insert({
      stage, step, day_offset: 1, channel: "push", enabled: false,
      title: "New nudge ✏️", body: "Hey {{name}} — …",
    });
    if (error) flash(error.message); else { flash("Step added (disabled until you enable it)"); load(); }
  };

  if (rows === null) return html`<div class="empty" style="border:0">Loading…</div>`;
  return html`<div style="display:flex;flex-direction:column;gap:14px;max-width:860px">
    <p class="tiny muted" style="margin:0">Templates: <code>{{name}}</code> <code>{{city}}</code> <code>{{community}}</code> <code>{{event}}</code> — filled per user at send time. Guardrails: one touch per user per 48h, 10:00–20:00 local, staff and opt-outs skipped, drips stop the moment a user advances.</p>
    ${STAGES.slice(0, 3).map(([n, label]) => html`<div class="card" key=${n}>
      <div class="sec-head">
        <div class="sec-title">Stage ${n} → ${n + 1} <span class="muted tiny" style="font-family:var(--body)">${label} → ${STAGES[n][1]}</span></div>
        <button class="btn small ghost" onClick=${() => add(n)}>+ step</button>
      </div>
      ${rows.filter((r) => r.stage === n).map((r) => html`<div class="crm-step" key=${r.id}>
        <label class="crm-toggle" title=${r.enabled ? "Live — click to pause" : "Paused — click to go live"}>
          <input type="checkbox" checked=${r.enabled} onChange=${(e) => save(r, { enabled: e.target.checked })} />
          <span>${r.enabled ? "live" : "off"}</span>
        </label>
        <span class="tiny muted">day</span>
        <input class="crm-day" type="number" min="0" value=${r.day_offset}
          onChange=${(e) => save(r, { day_offset: parseInt(e.target.value) || 0 })} />
        <select value=${r.channel} onChange=${(e) => save(r, { channel: e.target.value })}>
          ${CHANNELS.map((c) => html`<option value=${c}>${c === "push" ? "🔔 push" : c === "email" ? "✉️ email" : "🔔✉️ both"}</option>`)}
        </select>
        <div style="flex:1;min-width:220px;display:flex;flex-direction:column;gap:5px">
          <input value=${r.title} placeholder="Title / subject" onChange=${(e) => save(r, { title: e.target.value })} />
          <textarea rows="2" value=${r.body} onChange=${(e) => save(r, { body: e.target.value })}></textarea>
        </div>
        <button class="dt-del" title="Delete step" onClick=${() => del(r)}>✕</button>
      </div>`)}
      ${rows.filter((r) => r.stage === n).length === 0 && html`<div class="tiny muted">No steps — users at this stage get nothing.</div>`}
    </div>`)}
  </div>`;
}

function ActivityTab({ client, users, flash }) {
  const [touches, setTouches] = useState(null);
  const [engine, setEngine] = useState(null);   // last run result / preview
  const [busy, setBusy] = useState(false);
  const nameById = useMemo(() => new Map(users.map((u) => [u.id, u.display_name || u.email || "—"])), [users]);

  const load = useCallback(async () => {
    const { data } = await client.from("crm_touches").select("*").order("sent_at", { ascending: false }).limit(200);
    setTouches(data || []);
  }, [client]);
  useEffect(() => { load(); }, [load]);

  const run = async (dry) => {
    setBusy(true);
    const r = await runEngine(client, dry);
    setBusy(false);
    if (r.error) { flash(r.error); return; }
    setEngine({ ...r, dryLabel: dry });
    if (!dry) { flash(`Engine ran — ${r.touched} touch${r.touched === 1 ? "" : "es"}`); load(); }
  };

  return html`<div style="max-width:860px">
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px">
      <button class="btn small" disabled=${busy} onClick=${() => run(false)}>${busy ? "…" : "Run engine now"}</button>
      <button class="btn small ghost" disabled=${busy} onClick=${() => run(true)}>Preview what's due</button>
      <span class="tiny muted">Also runs automatically every hour at :15. Emails are dry-run until custom SMTP is set up.</span>
    </div>
    ${engine && html`<div class="card" style="margin-bottom:14px">
      <div class="sec-title" style="margin-bottom:8px">${engine.dryLabel ? "Due right now (nothing sent)" : "Last run"}</div>
      ${engine.dryLabel
        ? html`${(engine.planned || []).map((p, i) => html`<div class="crm-touchrow" key=${i}>
            <b>${p.profile || "—"}</b> <span class="pillstat">${p.channel}</span> <span class="tiny muted">stage ${p.stage} · step ${p.step}</span>
            <div class="tiny" style="width:100%"><b>${p.title}</b> — ${p.body}</div>
          </div>`)}
          ${(engine.planned || []).length === 0 && html`<div class="tiny muted">Nothing due.</div>`}`
        : html`<div class="tiny">touched ${engine.touched} · pushes delivered ${engine.pushed} · emails (dry) ${engine.dryEmails}</div>`}
      <div class="tiny muted" style="margin-top:6px">skipped: ${Object.entries(engine.skipped || {}).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"}</div>
    </div>`}
    ${touches === null ? html`<div class="empty" style="border:0">Loading…</div>`
      : html`<div class="card">
        <div class="sec-title" style="margin-bottom:10px">Touch log <span class="muted tiny" style="font-family:var(--body)">${touches.length} recent</span></div>
        ${touches.map((t) => html`<div class="crm-touchrow" key=${t.id}>
          <b>${nameById.get(t.profile_id) || "—"}</b>
          <span class="pillstat">${t.channel}</span>
          <span class="tiny muted">stage ${t.stage} · step ${t.step} · ${ago(t.sent_at)}</span>
          <span class="tiny" style="color:var(--teal-ink)">${t.result || ""}</span>
          <div class="tiny muted" style="width:100%">${t.title}</div>
        </div>`)}
        ${touches.length === 0 && html`<div class="tiny muted">No touches yet — the engine hasn't found anything due.</div>`}
      </div>`}
  </div>`;
}

export function CRMPage({ client, flash, sub }) {
  const tab = TABS.some(([k]) => k === sub) ? sub : "funnel";
  const [users, setUsers] = useState(null);

  useEffect(() => {
    let live = true;
    client.rpc("crm_users").then(({ data, error }) => {
      if (error) flash(error.message);
      if (live) setUsers(data || []);
    });
    return () => { live = false; };
  }, [client, tab]);

  return html`<div class="page" style="max-width:none">
    <div class="pagehead">
      <h2>CRM <span class="muted" style="font:400 13px var(--body)">user maturity funnel + the drip engine nudging everyone toward their next step</span></h2>
    </div>
    <div class="subnav" style="margin-bottom:14px">
      ${TABS.map(([k, label]) => html`<button class=${tab === k ? "on" : ""} onClick=${() => { location.hash = "/crm/" + k; }}>${label}</button>`)}
    </div>
    ${users === null ? html`<div class="empty" style="border:0">Loading…</div>`
      : tab === "funnel" ? html`<${FunnelBoard} users=${users} />`
      : tab === "campaigns" ? html`<${CampaignsTab} client=${client} flash=${flash} />`
      : html`<${ActivityTab} client=${client} users=${users} flash=${flash} />`}
  </div>`;
}
