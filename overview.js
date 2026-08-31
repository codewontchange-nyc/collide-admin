import { useState, useEffect } from "https://esm.sh/preact@10.23.2/hooks";
import { html, money, niceDate, todayStr, cityName } from "./ui.js?v=31";

/* Platform KPI strip — owner-only tiles above the community grid.
   Numbers come from the platform_kpis() RPC (server-side, auth-aware);
   deltas compare this week to last. */
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) + "%" : "—");
function Delta({ now, prev }) {
  const d = now - prev;
  if (d === 0) return html`<span class="kpi-delta flat">— wk</span>`;
  return html`<span class=${"kpi-delta " + (d > 0 ? "up" : "down")}>${d > 0 ? "▲" : "▼"}${Math.abs(d)} wk</span>`;
}
function KpiStrip({ k }) {
  const tiles = [
    { n: k.users_total, l: "users", d: html`<${Delta} now=${k.users_new_wk} prev=${k.users_new_prev} />` },
    { n: k.wau, l: "active this wk", s: pct(k.wau, k.signed_in_total) + " of signed-in" },
    { n: pct(k.activated, k.signed_in_total), l: "activated", s: "joined + RSVP'd" },
    { n: k.fully_activated, l: "power users", s: "yapping 🎓" },
    { n: k.rsvps_wk, l: "RSVPs", d: html`<${Delta} now=${k.rsvps_wk} prev=${k.rsvps_prev} />` },
    { n: k.yaps_wk, l: "yaps", d: html`<${Delta} now=${k.yaps_wk} prev=${k.yaps_prev} />` },
    { n: k.circles_wk, l: "new circles", d: html`<${Delta} now=${k.circles_wk} prev=${k.circles_prev} />` },
    { n: k.events_upcoming, l: "events upcoming" },
    { n: k.invites_sent > 0 ? pct(k.invites_accepted, k.invites_sent) : "—", l: "invite accept", s: `${k.invites_accepted}/${k.invites_sent} accepted` },
    { n: money(k.mrr_cents), l: "revenue / mo", money: true },
  ];
  return html`<div class="kpis">
    ${tiles.map((t) => html`<div class="kpi">
      <div class=${"kpi-n" + (t.money ? " money" : "")}>${t.n}</div>
      <div class="kpi-l">${t.l}${t.d || ""}</div>
      ${t.s && html`<div class="kpi-s">${t.s}</div>`}
    </div>`)}
  </div>`;
}

/* Owner home: every community at a glance — members (with week-over-week
   movement), pending join requests, and upcoming events. RLS scopes the
   community list, so facilitators with several communities get the same
   overview across just theirs. */

const DAY = 864e5;
const expired = (e) => !!e.expires_at && new Date(e.expires_at).getTime() < Date.now();

export function Overview({ client, communities, isOwner, flash, go, pickComm }) {
  const [members, setMembers] = useState(null);   // null = loading
  const [events, setEvents] = useState(null);
  const [openInvites, setOpenInvites] = useState(0);
  const [kpis, setKpis] = useState(null);   // null until the RPC answers (owner only)
  const [errors24, setErrors24] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      const [m, e, inv, k, errs] = await Promise.all([
        client.from("community_members").select("community_id, profile_id, status, joined_at"),
        client.from("activities").select("id, community_id, title, date, at_time, place, location, when_bucket, expires_at")
          .not("community_id", "is", null).order("date", { ascending: true, nullsFirst: false }).limit(500),
        client.from("invites").select("*", { count: "exact", head: true }).is("accepted_at", null),
        client.rpc("platform_kpis"),
        client.from("client_errors").select("*", { count: "exact", head: true })
          .gte("created_at", new Date(Date.now() - 864e5).toISOString()),
      ]);
      if (!live) return;
      setMembers(m.data || []);
      setEvents((e.data || []).filter((ev) => !expired(ev) && (!ev.date || ev.date >= todayStr())));
      setOpenInvites(inv.count || 0);
      setKpis(k.data || null);
      setErrors24(errs.count || 0);
    })();
    return () => { live = false; };
  }, [client, communities.map((c) => c.id).join()]);

  const now = Date.now();
  const living = communities.filter((c) => !c.archived_at);
  const archived = communities.filter((c) => c.archived_at);
  const loaded = members !== null;
  const stats = living.map((c) => {
    const mine = (members || []).filter((m) => m.community_id === c.id);
    const active = mine.filter((m) => m.status !== "pending");
    const pending = mine.length - active.length;
    const joinedIn = (from, to) => active.filter((m) => {
      const t = m.joined_at ? new Date(m.joined_at).getTime() : 0;
      return t > now - from * DAY && t <= now - to * DAY;
    }).length;
    const thisWeek = joinedIn(7, 0);
    const prevWeek = joinedIn(14, 7);
    const evs = (events || []).filter((e) => e.community_id === c.id);
    return { c, count: active.length, pending, thisWeek, prevWeek, evs };
  });

  const totals = {
    members: stats.reduce((a, s) => a + s.count, 0),
    thisWeek: stats.reduce((a, s) => a + s.thisWeek, 0),
    events: stats.reduce((a, s) => a + s.evs.length, 0),
    pending: stats.reduce((a, s) => a + s.pending, 0),
  };

  // Drilling into a community lands on its facilitator dashboard (or a tab of it)
  const open = (id, sub = "") => { pickComm(id); go("dashboard" + (sub ? "/" + sub : "")); };

  return html`<div>
    <div class="pagehead">
      <h2 style="margin:0;font:600 24px Fraunces,serif">All communities</h2>
      <div class="muted tiny">${living.length} communities · ${loaded ? totals.members : "…"} members
        ${totals.thisWeek > 0 && html` · <span style="color:var(--green);font-weight:600">+${totals.thisWeek} this week</span>`}
        · ${events === null ? "…" : totals.events} upcoming events${totals.pending > 0 && html` · <span style="color:#6d682f;font-weight:600">${totals.pending} pending</span>`}</div>
    </div>
    ${kpis && html`<${KpiStrip} k=${kpis} />`}
    ${(totals.pending > 0 || (isOwner && openInvites > 0) || errors24 > 0) && html`<div class="attention">
      <span class="attention-label">🔔 Needs attention</span>
      ${totals.pending > 0 && html`<button class="attention-chip" onClick=${() => {
        const c = stats.find((s) => s.pending > 0);
        if (isOwner) go("data/members");
        else if (c) { pickComm(c.c.id); go("dashboard/members"); }
      }}>${totals.pending} pending join request${totals.pending === 1 ? "" : "s"} →</button>`}
      ${isOwner && openInvites > 0 && html`<button class="attention-chip" onClick=${() => go("data/invites")}>
        ${openInvites} unaccepted invite${openInvites === 1 ? "" : "s"} →</button>`}
      ${errors24 > 0 && html`<button class="attention-chip" style="border-color:#f0cdc7;color:var(--danger)" onClick=${() => go("issues")}>
        🐛 ${errors24} error${errors24 === 1 ? "" : "s"} in 24h →</button>`}
    </div>`}
    <div class="ovgrid">
      ${stats.map(({ c, count, pending, thisWeek, prevWeek, evs }) => {
        const delta = thisWeek - prevWeek;
        return html`<div class="ovcard" key=${c.id}>
          <div class="ovhead" onClick=${() => open(c.id, "")}>
            <span class="ovemoji">${c.emoji || "🏘️"}</span>
            <div style="flex:1;min-width:0">
              <div class="ovname">${c.name} <span class="citychip">${cityName(c.city || "nyc")}</span></div>
              ${c.description && html`<div class="ovdesc">${c.description}</div>`}
            </div>
          </div>
          <div class="ovstats">
            <div class="ovstat" onClick=${() => open(c.id, "members")}>
              <div class="n">${loaded ? count : "…"}${thisWeek > 0 && html`<span class="rise">+${thisWeek}</span>`}</div>
              <div class="l">members</div>
            </div>
            <div class="ovstat">
              <div class="n" style=${delta > 0 ? "color:var(--green)" : delta < 0 ? "color:var(--danger)" : "color:var(--faint)"}>
                ${delta > 0 ? "▲" : delta < 0 ? "▼" : "—"}${Math.abs(delta) || ""}</div>
              <div class="l">wk / wk <span class="muted">(${prevWeek}→${thisWeek})</span></div>
            </div>
            <div class="ovstat" onClick=${() => open(c.id, "events")}>
              <div class="n">${events === null ? "…" : evs.length}</div>
              <div class="l">upcoming</div>
            </div>
            ${pending > 0 && html`<div class="ovstat" onClick=${() => open(c.id, "members")}>
              <div class="n" style="color:#6d682f">${pending}</div>
              <div class="l">pending</div>
            </div>`}
          </div>
          <div class="ovevents">
            ${evs.slice(0, 3).map((e) => html`<div class="ovev" key=${e.id} onClick=${() => open(c.id, "events")}>
              <span class="d">${e.date ? niceDate(e.date) : "soon"}${e.at_time ? " · " + e.at_time : ""}</span>
              <span class="t">${e.title}</span>
              ${(e.place || e.location) && html`<span class="p">📍 ${e.place || e.location}</span>`}
            </div>`)}
            ${events !== null && evs.length === 0 && html`<div class="ovev muted" onClick=${() => open(c.id, "events")}>No upcoming events — plan one →</div>`}
            ${evs.length > 3 && html`<button class="linkbtn tiny" onClick=${() => open(c.id, "events")}>all ${evs.length} events →</button>`}
          </div>
        </div>`;
      })}
      ${living.length === 0 && html`<div class="empty" style="grid-column:1/-1">No communities yet — create one in Settings.</div>`}
    </div>
    ${isOwner && archived.length > 0 && html`<div class="archived-row">
      🗂 Archived: ${archived.map((c) => `${c.name} (${cityName(c.city || "nyc")})`).join(" · ")}
      <button class="linkbtn tiny" onClick=${() => go("data/communities")}>manage →</button>
    </div>`}
  </div>`;
}
