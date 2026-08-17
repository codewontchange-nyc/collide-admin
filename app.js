import { render } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useMemo, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?bundle";
import { html, Avatar, money } from "./ui.js";
import { Dashboard } from "./dashboard.js";
import { EventsPage } from "./events.js";
import { AnnouncementsPage } from "./announcements.js";
import { MembersPage } from "./members.js";
import { MoneyPage } from "./money.js";
import { SettingsPage } from "./settings.js";
import { SharedMap } from "./sharedmap.js";
import { Overview } from "./overview.js";

/* Collide Admin — desktop console for owners & facilitators.
   Same Supabase project as the mobile app: everything managed here shows up
   in members' apps live (realtime). Access = a row in the `staff` table. */

const cfg = window.CA_CONFIG || {};
const client = (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY)
  ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
  : null;
window.CA = { client };   // debug/test hook

const PAGES = ["overview", "dashboard", "map", "announcements", "events", "members", "money", "settings"];
const PAGE_LABEL = { overview: "Overview", dashboard: "Dashboard", map: "Map", announcements: "Announcements", events: "Events", members: "Members", money: "Money", settings: "Settings" };

const routeNow = () => {
  const p = (location.hash || "").replace(/^#\/?/, "").split("/")[0];
  return PAGES.includes(p) ? p : "overview";   // home = the all-communities overview
};

function Login({ onSent, sent, error }) {
  const [email, setEmail] = useState("");
  const send = async (e) => {
    e.preventDefault();
    onSent(email.trim());
  };
  return html`<div class="login">
    <div class="boot-mark"><span class="dot pink"></span><span class="dot teal"></span></div>
    <h1>collide <span class="muted" style="font:400 18px Inter">admin</span></h1>
    <p>The desktop console for community owners and facilitators.</p>
    ${sent
      ? html`<p><b>Check your email 💌</b><br/>Tap the sign-in link we just sent to continue.</p>`
      : html`<form onSubmit=${send} style="display:flex;flex-direction:column;gap:10px;align-items:center">
          <input type="email" required placeholder="you@email.com" value=${email} onInput=${(e) => setEmail(e.target.value)} />
          <button class="btn" type="submit">Send me a sign-in link</button>
        </form>`}
    ${error && html`<p style="color:var(--danger)">${error}</p>`}
    <div class="note">No passwords. Access is limited to Collide staff.</div>
  </div>`;
}

function NotAuthorized({ email, onSignOut }) {
  return html`<div class="login">
    <div style="font-size:40px">🚪</div>
    <h1>Not authorized</h1>
    <p><b>${email}</b> isn't on the staff list for any community. Ask the owner to add you, then sign in again.</p>
    <button class="btn ghost" onClick=${onSignOut}>Sign out</button>
  </div>`;
}

function App() {
  const [session, setSession] = useState(undefined);   // undefined = checking
  const [sent, setSent] = useState(false);
  const [authErr, setAuthErr] = useState("");
  const [staffRows, setStaffRows] = useState(undefined); // undefined = loading
  const [communities, setCommunities] = useState([]);
  const [commId, setCommId] = useState(localStorage.getItem("ca.comm") || "");
  const [page, setPage] = useState(routeNow());
  const [profile, setProfile] = useState(null);
  const [toast, setToast] = useState("");

  const flash = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2200); }, []);

  /* ---- auth ---- */
  useEffect(() => {
    if (!client) return;
    client.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = client.auth.onAuthStateChange((_e, s) => setSession(s || null));
    return () => sub?.subscription?.unsubscribe();
  }, []);

  const sendLink = async (email) => {
    setAuthErr("");
    const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) setAuthErr(error.message);
    else setSent(true);
  };
  const signOut = () => client.auth.signOut();

  /* ---- staff gate + communities ---- */
  useEffect(() => {
    if (!session) { setStaffRows(undefined); return; }
    let live = true;
    (async () => {
      const { data: staff } = await client.from("staff").select("*");
      if (!live) return;
      const mine = (staff || []).filter((s) => s.email?.toLowerCase() === session.user.email?.toLowerCase());
      setStaffRows(mine);
      if (!mine.length) return;
      // RLS scopes this: owners see every community, facilitators just theirs
      const { data: comms } = await client.from("communities").select("*").order("created_at");
      if (!live) return;
      setCommunities(comms || []);
      const saved = localStorage.getItem("ca.comm");
      if (saved === "") setCommId("");                                  // "All communities"
      else if (saved && (comms || []).some((c) => c.id === saved)) setCommId(saved);
      else if (comms && comms.length) setCommId(comms[0].id);
      const { data: prof } = await client.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
      if (live) setProfile(prof || null);
    })();
    return () => { live = false; };
  }, [session?.user?.id]);

  /* ---- routing ---- */
  useEffect(() => {
    const onHash = () => setPage(routeNow());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = (p) => { location.hash = "/" + p; };

  const isOwner = useMemo(() => (staffRows || []).some((s) => s.role === "owner"), [staffRows]);
  const community = communities.find((c) => c.id === commId) || null;
  const pickComm = (id) => { localStorage.setItem("ca.comm", id); setCommId(id); };

  /* ---- monthly revenue figure for the top bar ---- */
  const [barTotal, setBarTotal] = useState(null);
  useEffect(() => {
    if (!community) return;
    let live = true;
    (async () => {
      const first = new Date(); first.setDate(1);
      const iso = first.toISOString().slice(0, 10);
      const [{ data: led }, { count }] = await Promise.all([
        client.from("ledger").select("amount_cents").eq("community_id", community.id).gte("happened_on", iso),
        client.from("community_members").select("*", { count: "exact", head: true }).eq("community_id", community.id).eq("status", "member"),
      ]);
      if (!live) return;
      const ledSum = (led || []).reduce((a, r) => a + r.amount_cents, 0);
      setBarTotal(ledSum + (count || 0) * (community.membership_price_cents || 0));
    })();
    return () => { live = false; };
  }, [community?.id, community?.membership_price_cents, page]);

  if (!client) return html`<div class="login"><h1>Setup needed</h1><p>config.js is missing its Supabase URL/key. Deploys write it from repo secrets.</p></div>`;
  if (session === undefined) return html`<div class="boot"><div class="boot-mark"><span class="dot pink"></span><span class="dot teal"></span></div><div class="boot-text">collide</div></div>`;
  if (!session) return html`<${Login} onSent=${sendLink} sent=${sent} error=${authErr} />`;
  if (staffRows === undefined) return html`<div class="boot"><div class="boot-mark"><span class="dot pink"></span><span class="dot teal"></span></div><div class="boot-text">checking access…</div></div>`;
  if (!staffRows.length) return html`<${NotAuthorized} email=${session.user.email} onSignOut=${signOut} />`;

  const ctx = { client, community, communities, isOwner, session, flash, go, pickComm };

  return html`<div class="shell side">
    <aside class="sidebar">
      <span class="wordmark" onClick=${() => go("overview")} title="All communities" style="cursor:pointer">collide</span>
      ${communities.length > 0 && html`<select class="commselect" value=${commId} onChange=${(e) => pickComm(e.target.value)}>
        <option value="">🌐 All communities</option>
        ${communities.map((c) => html`<option value=${c.id}>${c.name}</option>`)}
      </select>`}
      <nav class="sidenav">
        ${PAGES.map((p) => html`<button class=${page === p ? "on" : ""} onClick=${() => go(p)}>${PAGE_LABEL[p]}</button>`)}
        <button disabled title="Coming soon">Partnerships</button>
      </nav>
      <div class="sidefoot">
        ${barTotal != null && community && html`<span class="money">${money(barTotal)}</span>`}
        <${Avatar} profile=${profile || { display_name: session.user.email }} />
        <button class="linkbtn tiny" onClick=${signOut}>sign out</button>
      </div>
    </aside>
    <div class="main">
      ${page === "overview"
        ? html`<${Overview} ...${ctx} />`    /* all communities — no selection needed */
        : page === "map"
        ? html`<${SharedMap} ...${ctx} />`   /* the shared map is app-wide, no community needed */
        : page === "announcements"
        ? html`<${AnnouncementsPage} ...${ctx} />` /* announcements are app-wide too */
        : page === "dashboard"
        ? html`<${Dashboard} ...${ctx} />`   /* works scoped or across all communities */
        : page === "events"
        ? html`<${EventsPage} ...${ctx} />`  /* aggregates when All is selected */
        : !community
        ? html`<div class="empty">Pick a community in the sidebar${isOwner ? " — or create one in Settings." : "."}</div>`
        : page === "members" ? html`<${MembersPage} ...${ctx} />`
        : page === "money" ? html`<${MoneyPage} ...${ctx} />`
        : html`<${SettingsPage} ...${ctx} />`}
      ${isOwner && page === "settings" && null}
    </div>
    ${toast && html`<div class="toast">${toast}</div>`}
  </div>`;
}

render(html`<${App} />`, document.getElementById("app"));
