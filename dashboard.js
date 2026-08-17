import { useState, useEffect, useMemo, useRef } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Avatar, money, niceDate, niceTime, mediaUrl, todayStr } from "./ui.js";

/* Community dashboard: the LIVE app (phone-sized, signed in as you — same
   origin, shared session) on the left; contributors, stats, events and the
   POI grid to the right. */

const PHONE_W = 390, PHONE_H = 844;   // standard HD device points

function PhonePreview() {
  const wrap = useRef(null);
  const [s, setS] = useState(1);
  useEffect(() => {
    const fit = () => {
      const avail = window.innerHeight - 150;   // topbar + breathing room
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

export function Dashboard({ client, community, session, flash, go }) {
  const [members, setMembers] = useState([]);
  const [events, setEvents] = useState([]);
  const [pois, setPois] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [win, setWin] = useState("M");   // D / W / M for the Events & POI tile

  useEffect(() => {
    if (!community) return;
    let live = true;
    (async () => {
      const [m, e, p, l] = await Promise.all([
        client.from("community_members").select("status, joined_at, profile:profiles!community_members_profile_id_fkey(id,display_name,avatar_url)").eq("community_id", community.id),
        client.from("activities").select("*").eq("community_id", community.id).order("created_at", { ascending: false }).limit(100),
        client.from("pois").select("*").eq("community_id", community.id).order("created_at", { ascending: false }),
        client.from("ledger").select("amount_cents, happened_on").eq("community_id", community.id),
      ]);
      if (!live) return;
      // date-less plans (made from the phone) count as upcoming until they expire
      const upcoming = (e.data || [])
        .filter((ev) => ev.date ? ev.date >= todayStr() : !(ev.expires_at && new Date(ev.expires_at).getTime() < Date.now()))
        .sort((a, b) => (a.date || "9999") < (b.date || "9999") ? -1 : 1);
      setMembers(m.data || []); setEvents(upcoming); setPois(p.data || []); setLedger(l.data || []);
    })();
    return () => { live = false; };
  }, [community?.id]);

  const active = members.filter((m) => m.status !== "pending");
  const monthStart = useMemo(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); }, []);
  const joinedThisMonth = active.filter((m) => (m.joined_at || "") >= monthStart).length;

  const winStart = useMemo(() => {
    const d = new Date();
    if (win === "D") return todayStr();
    if (win === "W") { d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); }
    d.setDate(1); return d.toISOString().slice(0, 10);
  }, [win]);
  const ledgerSum = ledger.filter((r) => r.happened_on >= winStart).reduce((a, r) => a + r.amount_cents, 0);
  const membershipMo = active.length * (community.membership_price_cents || 0);

  return html`<div class="dash2">
    <${PhonePreview} />
    <div class="dash-right">
      <div class="section-label">Contributors</div>
      <div class="contribrow">
        ${active.slice(0, 7).map((m) => html`<${Avatar} profile=${m.profile} size="lg" />`)}
        <button class="addbtn" title="Invite members" onClick=${() => go("members")}>+</button>
      </div>

      <div class="stats">
        <div class="stat">
          <div class="lab">Members</div>
          <div class="num">${active.length}${joinedThisMonth > 0 && html`<span class="rise">+${joinedThisMonth}</span>`}</div>
        </div>
        <div class="stat">
          <div class="lab">Memberships <span class="muted">${money(community.membership_price_cents || 0)}</span></div>
          <div class="num money">${money(membershipMo)}<span class="unit">mo</span></div>
        </div>
        <div class="stat">
          <div class="lab">Events ${"&"} POI
            <span class="dwm">
              ${["D", "W", "M"].map((w) => html`<button class=${win === w ? "on" : ""} onClick=${() => setWin(w)}>${w}</button>`)}
            </span>
          </div>
          <div class="num money">${money(ledgerSum)}</div>
        </div>
      </div>

      <div class="dashcols">
        <div>
          <div class="pagehead">
            <div class="section-label" style="margin:0">Upcoming Events</div>
            <button class="btn pill" onClick=${() => go("events")}>create new</button>
          </div>
          <div class="evlist">
            ${events.slice(0, 4).map((e) => html`<div class="evcard" onClick=${() => go("events")} style="cursor:pointer">
              ${e.image_path
                ? html`<img class="thumb" src=${mediaUrl(client, e.image_path)} alt="" />`
                : html`<div class="thumb">🗓️</div>`}
              <div>
                <div class="t">${e.title}</div>
                <div class="d">${niceDate(e.date || "")}${e.starts_at ? " · " + niceTime(e.starts_at) : ""}${e.location ? " · " + e.location : ""}</div>
              </div>
            </div>`)}
            ${events.length === 0 && html`<div class="empty">No upcoming events — create the first one 🎉</div>`}
            ${events.length > 4 && html`<button class="seeall" onClick=${() => go("events")}>see all ${events.length}</button>`}
          </div>
        </div>
        <div>
          <div class="pagehead">
            <div class="section-label" style="margin:0">Points of Interest</div>
            <span class="muted tiny">${pois.length}</span>
          </div>
          <div class="poigrid">
            ${pois.slice(0, 9).map((p) => html`<div class="poi" onClick=${() => go("map")} style="cursor:pointer">
              <div class="disc">${p.image_path ? html`<img src=${mediaUrl(client, p.image_path)} alt="" />` : "📍"}</div>
              <div class="n">${p.name}</div>
              ${p.category && html`<div class="c">${p.category}</div>`}
            </div>`)}
            ${pois.length === 0 && html`<div class="empty" style="grid-column:1/-1;cursor:pointer" onClick=${() => go("map")}>No points of interest yet — drop dots on the map ⚫</div>`}
          </div>
        </div>
      </div>
    </div>
  </div>`;
}
