import { useState, useEffect, useMemo, useRef } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Avatar, money, niceDate, niceTime, mediaUrl, todayStr } from "./ui.js";

/* The desk view: data on the left, the REAL app living on the right.
   The phone iframe is the actual mobile PWA on this same origin, so it runs
   as the signed-in staffer with realtime — post an event, watch it land. */

export function Dashboard({ client, community, communities, session, flash, go }) {
  const [members, setMembers] = useState([]);
  const [events, setEvents] = useState([]);
  const [pois, setPois] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [win, setWin] = useState("M");   // D / W / M for the Events & POI tile
  const frame = useRef(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const scoped = (q) => community ? q.eq("community_id", community.id) : q;
      const [m, e, p, l] = await Promise.all([
        scoped(client.from("community_members").select("community_id, status, joined_at, profile:profiles!community_members_profile_id_fkey(id,display_name,avatar_url)")),
        scoped(client.from("activities").select("*")).order("created_at", { ascending: false }).limit(150),
        scoped(client.from("pois").select("*")).order("created_at", { ascending: false }),
        scoped(client.from("ledger").select("amount_cents, happened_on")),
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
  const membershipMo = community ? active.length * (community.membership_price_cents || 0) : null;
  const cname = (id) => communities.find((c) => c.id === id)?.name;

  return html`<div class="dash">
    <div>
      <div class="pagehead"><h2 style="margin:0">${community ? community.name : "All communities"}</h2></div>
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
        ${membershipMo != null && html`<div class="stat">
          <div class="lab">Memberships <span class="muted">${money(community.membership_price_cents || 0)}</span></div>
          <div class="num money">${money(membershipMo)}<span class="unit">mo</span></div>
        </div>`}
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
                <div class="d">${niceDate(e.date || "")}${e.starts_at ? " · " + niceTime(e.starts_at) : ""}${e.location ? " · " + e.location : ""}${!community && cname(e.community_id) ? html` · <b>${cname(e.community_id)}</b>` : ""}</div>
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

    <div class="phonecol">
      <div class="pagehead">
        <div class="section-label" style="margin:0">Live app</div>
        <button class="linkbtn tiny" onClick=${() => { if (frame.current) frame.current.src = frame.current.src; }}>refresh</button>
      </div>
      <div class="phone"><iframe ref=${frame} src="/Collide/" title="Collide — live app preview"></iframe></div>
      <p class="tiny muted" style="max-width:340px">The real app, live and signed in as you — post an event or announcement and watch it land here in realtime.</p>
    </div>
  </div>`;
}
