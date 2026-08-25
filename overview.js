import { useState, useEffect } from "https://esm.sh/preact@10.23.2/hooks";
import { html, money, niceDate, todayStr } from "./ui.js?v=4";

/* Owner home: every community at a glance — members (with week-over-week
   movement), pending join requests, and upcoming events. RLS scopes the
   community list, so facilitators with several communities get the same
   overview across just theirs. */

const DAY = 864e5;
const expired = (e) => !!e.expires_at && new Date(e.expires_at).getTime() < Date.now();

export function Overview({ client, communities, flash, go, pickComm }) {
  const [members, setMembers] = useState([]);
  const [events, setEvents] = useState([]);

  useEffect(() => {
    let live = true;
    (async () => {
      const [m, e] = await Promise.all([
        client.from("community_members").select("community_id, profile_id, status, joined_at"),
        client.from("activities").select("id, community_id, title, date, at_time, place, location, when_bucket, expires_at")
          .not("community_id", "is", null).order("date", { ascending: true, nullsFirst: false }).limit(500),
      ]);
      if (!live) return;
      setMembers(m.data || []);
      setEvents((e.data || []).filter((ev) => !expired(ev) && (!ev.date || ev.date >= todayStr())));
    })();
    return () => { live = false; };
  }, [client, communities.map((c) => c.id).join()]);

  const now = Date.now();
  const stats = communities.map((c) => {
    const mine = members.filter((m) => m.community_id === c.id);
    const active = mine.filter((m) => m.status !== "pending");
    const pending = mine.length - active.length;
    const joinedIn = (from, to) => active.filter((m) => {
      const t = m.joined_at ? new Date(m.joined_at).getTime() : 0;
      return t > now - from * DAY && t <= now - to * DAY;
    }).length;
    const thisWeek = joinedIn(7, 0);
    const prevWeek = joinedIn(14, 7);
    const evs = events.filter((e) => e.community_id === c.id);
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
      <div class="muted tiny">${communities.length} communities · ${totals.members} members
        ${totals.thisWeek > 0 && html` · <span style="color:var(--green);font-weight:600">+${totals.thisWeek} this week</span>`}
        · ${totals.events} upcoming events${totals.pending > 0 && html` · <span style="color:#6d682f;font-weight:600">${totals.pending} pending</span>`}</div>
    </div>
    <div class="ovgrid">
      ${stats.map(({ c, count, pending, thisWeek, prevWeek, evs }) => {
        const delta = thisWeek - prevWeek;
        return html`<div class="ovcard" key=${c.id}>
          <div class="ovhead" onClick=${() => open(c.id, "")}>
            <span class="ovemoji">${c.emoji || "🏘️"}</span>
            <div style="flex:1;min-width:0">
              <div class="ovname">${c.name}</div>
              ${c.description && html`<div class="ovdesc">${c.description}</div>`}
            </div>
          </div>
          <div class="ovstats">
            <div class="ovstat" onClick=${() => open(c.id, "members")}>
              <div class="n">${count}${thisWeek > 0 && html`<span class="rise">+${thisWeek}</span>`}</div>
              <div class="l">members</div>
            </div>
            <div class="ovstat">
              <div class="n" style=${delta > 0 ? "color:var(--green)" : delta < 0 ? "color:var(--danger)" : "color:var(--faint)"}>
                ${delta > 0 ? "▲" : delta < 0 ? "▼" : "—"}${Math.abs(delta) || ""}</div>
              <div class="l">wk / wk <span class="muted">(${prevWeek}→${thisWeek})</span></div>
            </div>
            <div class="ovstat" onClick=${() => open(c.id, "events")}>
              <div class="n">${evs.length}</div>
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
            ${evs.length === 0 && html`<div class="ovev muted" onClick=${() => open(c.id, "events")}>No upcoming events — plan one →</div>`}
            ${evs.length > 3 && html`<button class="linkbtn tiny" onClick=${() => open(c.id, "events")}>all ${evs.length} events →</button>`}
          </div>
        </div>`;
      })}
      ${communities.length === 0 && html`<div class="empty" style="grid-column:1/-1">No communities yet — create one in Settings.</div>`}
    </div>
  </div>`;
}
