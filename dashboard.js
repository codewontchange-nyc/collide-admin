import { useState, useEffect, useMemo } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Avatar, money, niceDate, niceTime, mediaUrl, todayStr } from "./ui.js";
import { MapView } from "./map-widget.js";

/* The mockup screen: map + contributors + stat tiles + upcoming events + POI grid. */

export function Dashboard({ client, community, go }) {
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
        client.from("activities").select("*").eq("community_id", community.id).gte("date", todayStr()).order("date").limit(50),
        client.from("pois").select("*").eq("community_id", community.id).order("created_at", { ascending: false }),
        client.from("ledger").select("amount_cents, happened_on").eq("community_id", community.id),
      ]);
      if (!live) return;
      setMembers(m.data || []); setEvents(e.data || []); setPois(p.data || []); setLedger(l.data || []);
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

  const pins = [
    ...pois.map((p) => ({ lat: p.lat, lng: p.lng, label: p.name, color: "#219a8f" })),
    ...events.map((e) => ({ lat: e.lat, lng: e.lng, label: e.title, color: "#e85d75" })),
  ];

  return html`<div class="dash">
    <div class="mapcard"><${MapView} pins=${pins} /></div>
    <div>
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
            ${events.slice(0, 3).map((e) => html`<div class="evcard" onClick=${() => go("events")} style="cursor:pointer">
              ${e.image_path
                ? html`<img class="thumb" src=${mediaUrl(client, e.image_path)} alt="" />`
                : html`<div class="thumb">🗓️</div>`}
              <div>
                <div class="t">${e.title}</div>
                <div class="d">${niceDate(e.date || "")}${e.starts_at ? " · " + niceTime(e.starts_at) : ""}${e.location ? " · " + e.location : ""}</div>
              </div>
            </div>`)}
            ${events.length === 0 && html`<div class="empty">No upcoming events — create the first one 🎉</div>`}
            ${events.length > 3 && html`<button class="seeall" onClick=${() => go("events")}>see all ${events.length}</button>`}
          </div>
        </div>
        <div>
          <div class="pagehead">
            <div class="section-label" style="margin:0">Points of Interest</div>
            <span class="muted tiny">${pois.length}</span>
          </div>
          <div class="poigrid">
            ${pois.slice(0, 9).map((p) => html`<div class="poi" onClick=${() => go("pois")} style="cursor:pointer">
              <div class="disc">${p.image_path ? html`<img src=${mediaUrl(client, p.image_path)} alt="" />` : "📍"}</div>
              <div class="n">${p.name}</div>
              ${p.category && html`<div class="c">${p.category}</div>`}
            </div>`)}
            ${pois.length === 0 && html`<div class="empty" style="grid-column:1/-1">No points of interest yet — pin your favorites 📍</div>`}
          </div>
        </div>
      </div>
    </div>
  </div>`;
}
