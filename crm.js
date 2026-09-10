import { useState, useMemo } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Page, Tabs, Pill, Avatar, Loading, Empty, LoadError, agoDay, DAY, confirmDanger } from "./ui.js?v=__V__";
import { useLoader, runEngine, showError } from "./db.js?v=__V__";
import { PAGE } from "./routes.js?v=__V__";

/* CRM — watch users move down the maturity funnel and run the drip engine.
   Funnel: stages derived live from real actions (crm_users RPC). Campaigns:
   the editable drip steps. Activity: every touch the engine sent, plus
   run-now / preview controls. Owner-only, like Data. */

const STAGES = [
  [0, "Invited", "account created, never signed in — invite reminders chase acceptance"],
  [1, "Signed up", "hasn't joined or RSVP'd yet"],
  [2, "Joined & RSVP'd", "in a community or on a roster"],
  [3, "In a circle", "connected, hasn't yapped"],
  [4, "Yapping", "fully activated 🎓"],
];
const CHANNELS = ["push", "email", "both"];
const daysIn = (iso) => Math.floor((Date.now() - new Date(iso)) / DAY);

function FunnelBoard({ users }) {
  const reached = (n) => users.filter((u) => u.stage >= n).length;
  return html`<div class="crm-cols">
    ${STAGES.map(([n, label, hint]) => {
      const here = users.filter((u) => u.stage === n)
        .sort((a, b) => new Date(a.stage_entered_at) - new Date(b.stage_entered_at));
      const conv = n < 4 && reached(n) > 0 ? Math.round(reached(n + 1) / reached(n) * 100) : null;
      return html`<div class="crm-col inset" key=${n}>
        <div class="crm-colhead">
          <div><span class="crm-stageno">${n}</span> <b>${label}</b></div>
          <div class="crm-count">${here.length}</div>
        </div>
        <div class="tiny muted" style="margin-bottom:8px">${hint}${conv != null && html` · <b class="tone-ok">${conv}%</b> advance`}</div>
        ${here.map((u) => html`<div class="crm-user" key=${u.id}>
          <${Avatar} profile=${u} size="sm" />
          <div class="u-grow">
            <div class="n">${u.display_name || u.email || "—"}${u.is_staff && html` <${Pill} tone="brand" sm>staff</${Pill}>`}${u.opt_out && html` <${Pill} tone="neutral" sm>opted out</${Pill}>`}</div>
            <div class="d">${daysIn(u.stage_entered_at)}d in stage · ${u.touches > 0 ? `${u.touches} touch${u.touches === 1 ? "" : "es"}, last ${agoDay(u.last_touch_at)}` : "untouched"}</div>
          </div>
        </div>`)}
        ${here.length === 0 && html`<div class="tiny muted" style="padding:8px 0">Nobody here.</div>`}
      </div>`;
    })}
  </div>`;
}

function CampaignsTab({ client, flash }) {
  const { data: rows, error, reload, setData } = useLoader(() => client.from("crm_campaigns").select("*").order("stage").order("step"), [client], { flash, where: "Campaigns" });

  const save = async (r, patch) => {
    const { error: e } = await client.from("crm_campaigns").update(patch).eq("id", r.id);
    if (e) showError(flash, "Save step", e);
    else setData((rs) => rs.map((x) => (x.id === r.id ? { ...x, ...patch } : x)));
  };
  const del = async (r) => {
    if (!confirmDanger(`Delete step ${r.step} of stage ${r.stage}? Its send history stays.`)) return;
    const { error: e } = await client.from("crm_campaigns").delete().eq("id", r.id);
    if (e) showError(flash, "Delete step", e); else { flash("Step deleted"); reload(); }
  };
  const add = async (stage) => {
    const step = Math.max(0, ...(rows || []).filter((r) => r.stage === stage).map((r) => r.step)) + 1;
    const { error: e } = await client.from("crm_campaigns").insert({
      stage, step, day_offset: 1, channel: stage === 0 ? "email" : "push", enabled: false,
      title: stage === 0 ? `Invite reminder #${step}` : "New nudge ✏️",
      body: stage === 0 ? "(re-sends their invite sign-in link)" : "Hey {{name}} — …",
    });
    if (e) showError(flash, "Add step", e); else { flash("Step added (disabled until you enable it)"); reload(); }
  };

  if (error) return html`<${LoadError} what="campaigns" error=${error} onRetry=${reload} />`;
  if (rows === null) return html`<${Loading} />`;
  return html`<div class="u-col reading" style="gap:14px">
    <p class="tiny muted" style="margin:0">Templates: <code>{{name}}</code> <code>{{city}}</code> <code>{{community}}</code> <code>{{event}}</code> — filled per user at send time. Guardrails: one touch per user per 48h, 10:00–20:00 local, staff and opt-outs skipped, drips stop the moment a user advances.</p>
    ${STAGES.slice(0, 4).map(([n, label]) => html`<div class="inset" key=${n}>
      <div class="sec-head">
        <div class="sec-title">Stage ${n} → ${n + 1} <span class="muted tiny" style="font-family:var(--body)">${label} → ${STAGES[n + 1][1]}</span></div>
        <button class="btn sm ghost" onClick=${() => add(n)}>+ step</button>
      </div>
      ${n === 0 && html`<p class="tiny muted" style="margin:0 0 4px">Reminders re-send the invitee's sign-in link (the branded invite template) — only the timing is edited here. Days count from the invite.</p>`}
      ${rows.filter((r) => r.stage === n).map((r) => html`<div class="crm-step" key=${r.id}>
        <label class="crm-toggle" title=${r.enabled ? "Live — click to pause" : "Paused — click to go live"}>
          <input type="checkbox" checked=${r.enabled} onChange=${(e) => save(r, { enabled: e.target.checked })} />
          <span>${r.enabled ? "live" : "off"}</span>
        </label>
        <span class="tiny muted">day</span>
        <input class="crm-day" type="number" min="0" value=${r.day_offset}
          onChange=${(e) => save(r, { day_offset: parseInt(e.target.value) || 0 })} />
        ${n === 0
          ? html`<div class="u-grow tiny muted" style="min-width:220px;padding-top:7px">✉️ ${r.title} — re-sends their invite sign-in link</div>`
          : html`
        <select value=${r.channel} onChange=${(e) => save(r, { channel: e.target.value })}>
          ${CHANNELS.map((c) => html`<option value=${c}>${c === "push" ? "🔔 push" : c === "email" ? "✉️ email" : "🔔✉️ both"}</option>`)}
        </select>
        <div class="u-col u-grow" style="min-width:220px;gap:5px">
          <input value=${r.title} placeholder="Title / subject" onChange=${(e) => save(r, { title: e.target.value })} />
          <textarea rows="2" value=${r.body} onChange=${(e) => save(r, { body: e.target.value })}></textarea>
        </div>`}
        <button class="dt-del" title="Delete step" aria-label="Delete step" onClick=${() => del(r)}>✕</button>
      </div>`)}
      ${rows.filter((r) => r.stage === n).length === 0 && html`<div class="tiny muted">No steps — users at this stage get nothing.</div>`}
    </div>`)}
  </div>`;
}

function ActivityTab({ client, users, flash }) {
  const [engine, setEngine] = useState(null);   // last run result / preview
  const [busy, setBusy] = useState(false);
  const nameById = useMemo(() => new Map(users.map((u) => [u.id, u.display_name || u.email || "—"])), [users]);
  const { data: touches, error, reload } = useLoader(() => client.from("crm_touches").select("*").order("sent_at", { ascending: false }).limit(200), [client], { flash, where: "Touch log" });

  const run = async (dry) => {
    setBusy(true);
    const r = await runEngine(client, dry);
    setBusy(false);
    if (r.error) { showError(flash, "Engine", r.error); return; }
    setEngine({ ...r, dryLabel: dry });
    if (!dry) { flash(`Engine ran — ${r.touched} touch${r.touched === 1 ? "" : "es"}`); reload(); }
  };

  return html`<div class="reading">
    <div class="u-row" style="margin-bottom:14px">
      <button class="btn sm" disabled=${busy} onClick=${() => run(false)}>${busy ? "Running…" : "Run engine now"}</button>
      <button class="btn sm ghost" disabled=${busy} onClick=${() => run(true)}>Preview what's due</button>
      <span class="tiny muted">Also runs automatically every hour at :15. Emails are dry-run until custom SMTP is set up.</span>
    </div>
    ${engine && html`<div class="inset" style="margin-bottom:14px">
      <div class="sec-title" style="margin-bottom:8px">${engine.dryLabel ? "Due right now (nothing sent)" : "Last run"}</div>
      ${engine.dryLabel
        ? html`${(engine.planned || []).map((p, i) => html`<div class="crm-touchrow" key=${i}>
            <b>${p.profile || "—"}</b> <${Pill} tone="neutral">${p.channel}</${Pill}> <span class="tiny muted">stage ${p.stage} · step ${p.step}</span>
            <div class="tiny" style="width:100%"><b>${p.title}</b> — ${p.body}</div>
          </div>`)}
          ${(engine.planned || []).length === 0 && html`<div class="tiny muted">Nothing due.</div>`}`
        : html`<div class="tiny">touched ${engine.touched} · pushes delivered ${engine.pushed} · emails (dry) ${engine.dryEmails}</div>`}
      <div class="tiny muted" style="margin-top:6px">skipped: ${Object.entries(engine.skipped || {}).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"}</div>
    </div>`}
    ${error ? html`<${LoadError} what="the touch log" error=${error} onRetry=${reload} />`
      : touches === null ? html`<${Loading} />`
      : html`<div class="inset">
        <div class="sec-title" style="margin-bottom:10px">Touch log <span class="muted tiny" style="font-family:var(--body)">${touches.length} recent</span></div>
        ${touches.map((t) => html`<div class="crm-touchrow" key=${t.id}>
          <b>${nameById.get(t.profile_id) || "—"}</b>
          <${Pill} tone="neutral">${t.channel}</${Pill}>
          <span class="tiny muted">stage ${t.stage} · step ${t.step} · ${agoDay(t.sent_at)}</span>
          <span class="tiny tone-ok">${t.result || ""}</span>
          <div class="tiny muted" style="width:100%">${t.title}</div>
        </div>`)}
        ${touches.length === 0 && html`<div class="tiny muted">No touches yet — the engine hasn't found anything due.</div>`}
      </div>`}
  </div>`;
}

export function CRMPage({ client, flash, sub, go }) {
  const tab = PAGE.crm.tabs.some(([k]) => k === sub) ? sub : "funnel";
  const { data: users, error, reload } = useLoader(() => client.rpc("crm_users"), [client, tab], { flash, where: "CRM" });

  return html`<${Page} title="CRM" sub="user maturity funnel + the drip engine nudging everyone toward their next step">
    <${Tabs} page="crm" current=${tab} go=${go} />
    ${error ? html`<${LoadError} what="the funnel" error=${error} onRetry=${reload} />`
      : users === null ? html`<${Loading} />`
      : tab === "funnel" ? html`<${FunnelBoard} users=${users} />`
      : tab === "campaigns" ? html`<${CampaignsTab} client=${client} flash=${flash} />`
      : html`<${ActivityTab} client=${client} users=${users} flash=${flash} />`}
  </${Page}>`;
}
