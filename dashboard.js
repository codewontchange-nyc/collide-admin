import { useState, useEffect, useMemo, useRef } from "https://esm.sh/preact@10.23.2/hooks";
import { useLoader, firstError } from "./db.js?v=__V__";
import { html, Avatar, Tabs, Metrics, Empty, LoadError, money, niceDate, niceTime, mediaUrl, todayStr, monthStartStr, daysAgoStr } from "./ui.js?v=__V__";
import { PAGE } from "./routes.js?v=__V__";
import { EventsPage } from "./events.js?v=__V__";
import { AnnouncementsPage } from "./announcements.js?v=__V__";
import { MembersPage } from "./members.js?v=__V__";
import { MoneyPage } from "./money.js?v=__V__";
import { MealsPage } from "./meals.js?v=__V__";
import { SettingsPage } from "./settings.js?v=__V__";
import { PartnershipsPage } from "./partnerships.js?v=__V__";

/* The facilitator view, whole: the LIVE app (phone-sized, signed in as you)
   on the left, and every facilitator section as a tab on the right — all of
   it scoped to the community picked in the top bar. This is the exact slice
   a facilitator sees when they log in; the Map keeps its own page because
   it's shared app-wide. */

const PHONE_W = 390, PHONE_H = 844;   // standard HD device points

function PhonePreview() {
  const wrap = useRef(null);
  const [s, setS] = useState(1);
  useEffect(() => {
    const fit = () => {
      const avail = window.innerHeight - 60 - 90;   // --topbar-h + breathing room
      setS(Math.min(1, avail / PHONE_H));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return html`<div class="phone-col" style=${`width:${Math.round(PHONE_W * s)}px`}>
    <div class="phone-shell" style=${`width:${Math.round(PHONE_W * s)}px;height:${Math.round(PHONE_H * s)}px`}>
      <div class="phone-frame" style=${`transform:scale(${s})`}>
        <iframe class="phone-iframe" src="/Collide/" title="Live app" />
      </div>
    </div>
    <p class="muted tiny phone-cap">The real app, signed in as you — post an event or announcement and watch it land in realtime.</p>
  </div>`;
}

export function Dashboard(props) {
  const { go, sub, community, communities, pickComm } = props;
  const tab = PAGE.dashboard.tabs.some(([k]) => k === sub && k) ? sub : "home";
  const pickable = (communities || []).filter((c) => !c.archived_at || c.id === community.id);
  return html`<div class="dash2">
    <${PhonePreview} />
    <div class="dash-right">
      <${Tabs} page="dashboard" current=${tab === "home" ? "" : tab} go=${go}>
        ${pickable.length > 1
          ? html`<select class="commselect" value=${community.id} onChange=${(e) => pickComm(e.target.value)}
              title="Viewing this community's slice — how its facilitators see the platform">
              ${pickable.map((c) => html`<option value=${c.id}>${c.archived_at ? "🗂 " : ""}${c.name}</option>`)}
            </select>`
          : null}
      </${Tabs}>
      ${tab === "home" ? html`<${DashHome} key=${community.id} ...${props} />`
        : tab === "announcements" ? html`<${AnnouncementsPage} key=${community.id} ...${props} />`
        : tab === "events" ? html`<${EventsPage} key=${community.id} ...${props} />`
        : tab === "members" ? html`<${MembersPage} key=${community.id} ...${props} />`
        : tab === "money" ? html`<${MoneyPage} key=${community.id} ...${props} />`
        : tab === "meals" ? html`<${MealsPage} key=${community.id} ...${props} />`
        : tab === "settings" ? html`<${SettingsPage} key=${community.id} ...${props} />`
        : html`<${PartnershipsPage} key=${community.id} ...${props} />`}
    </div>
  </div>`;
}

function DashHome({ client, community, flash, go }) {
  const [win, setWin] = useState("M");   // D / W / M for the Events & POI tile
  const { data, error, reload } = useLoader(async () => {
    const [m, e, p, l] = await Promise.all([
      client.from("community_members").select("status, joined_at, profile:profiles!community_members_profile_id_fkey(id,display_name,avatar_url)").eq("community_id", community.id),
      client.from("activities").select("id,title,date,starts_at,location,image_path,expires_at,created_at").eq("community_id", community.id).order("created_at", { ascending: false }).limit(100),
      client.from("pois").select("id,name,category,image_path,created_at").eq("community_id", community.id).order("created_at", { ascending: false }),
      client.from("ledger").select("amount_cents, happened_on").eq("community_id", community.id),
    ]);
    const err = firstError([m, e, p, l]); if (err) return { error: err };
    // date-less plans (made from the phone) count as upcoming until they expire
    const upcoming = (e.data || [])
      .filter((ev) => ev.date ? ev.date >= todayStr() : !(ev.expires_at && new Date(ev.expires_at).getTime() < Date.now()))
      .sort((a, b) => (a.date || "9999") < (b.date || "9999") ? -1 : 1);
    return { data: { members: m.data || [], events: upcoming, pois: p.data || [], ledger: l.data || [] } };
  }, [client, community?.id], { flash, where: "Dashboard" });

  const loading = data === null;
  const d = data && !Array.isArray(data) ? data : { members: [], events: [], pois: [], ledger: [] };
  const active = d.members.filter((m) => m.status !== "pending");
  const monthStart = monthStartStr();
  const joinedThisMonth = active.filter((m) => (m.joined_at || "") >= monthStart).length;
  const winStart = win === "D" ? todayStr() : win === "W" ? daysAgoStr(7) : monthStart;
  const ledgerSum = d.ledger.filter((r) => r.happened_on >= winStart).reduce((a, r) => a + r.amount_cents, 0);
  const membershipMo = active.length * (community.membership_price_cents || 0);
  const events = loading ? null : d.events, pois = loading ? null : d.pois;

  return html`<div class="dashhome">
    <div class="card">
      <div class="sec-head">
        <div class="sec-title">${community.name}</div>
        <div class="contribrow">
          ${active.slice(0, 7).map((m) => html`<${Avatar} profile=${m.profile} size="lg" />`)}
          <button class="addbtn" title="Invite members" onClick=${() => go("dashboard/members")}>+</button>
        </div>
      </div>

      ${error && html`<${LoadError} what="this dashboard" error=${error} onRetry=${reload} />`}
      <${Metrics} loading=${loading} className="u-mt-1" items=${[
        ["Members", html`${active.length}${joinedThisMonth > 0 && html`<span class="rise">+${joinedThisMonth}</span>`}`],
        [html`Memberships <span class="muted">${money(community.membership_price_cents || 0)}</span>`, html`${money(membershipMo)}<span class="unit">mo</span>`, { money: true }],
        [html`Events ${"&"} POI <span class="dwm">${["D", "W", "M"].map((w) => html`<button class=${win === w ? "on" : ""} onClick=${() => setWin(w)}>${w}</button>`)}</span>`, money(ledgerSum), { money: true }],
      ]} />
    </div>

    <div class="dashcols">
      <div class="card">
        <div class="sec-head">
          <div class="sec-title">Upcoming events</div>
          <button class="btn pill" onClick=${() => go("dashboard/events")}>create new</button>
        </div>
        <div class="evlist">
          ${(events || []).slice(0, 4).map((e) => html`<div class="evcard" onClick=${() => go("dashboard/events")} style="cursor:pointer">
            ${e.image_path
              ? html`<img class="thumb" src=${mediaUrl(client, e.image_path)} alt="" />`
              : html`<div class="thumb">🗓️</div>`}
            <div>
              <div class="t">${e.title}</div>
              <div class="d">${niceDate(e.date || "")}${e.starts_at ? " · " + niceTime(e.starts_at) : ""}${e.location ? " · " + e.location : ""}</div>
            </div>
          </div>`)}
          ${events !== null && events.length === 0 && html`<${Empty}>No upcoming events — create the first one 🎉</${Empty}>`}${events === null && html`<${Empty} bare>Loading…</${Empty}>`}
          ${events !== null && events.length > 4 && html`<button class="seeall" onClick=${() => go("dashboard/events")}>see all ${events.length}</button>`}
        </div>
      </div>
      <div class="card">
        <div class="sec-head">
          <div class="sec-title">Points of interest</div>
          <span class="muted tiny">${pois === null ? "…" : pois.length}</span>
        </div>
        <div class="poigrid">
          ${(pois || []).slice(0, 9).map((p) => html`<div class="poi" onClick=${() => go("map")} style="cursor:pointer">
            <div class="disc">${p.image_path ? html`<img src=${mediaUrl(client, p.image_path)} alt="" />` : "📍"}</div>
            <div class="n">${p.name}</div>
            ${p.category && html`<div class="c">${p.category}</div>`}
          </div>`)}
          ${pois !== null && pois.length === 0 && html`<${Empty} span onClick=${() => go("map")}>No points of interest yet — drop dots on the map ⚫</${Empty}>`}
        </div>
      </div>
    </div>
  </div>`;
}
