import { render } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useMemo, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?bundle";
import { html, Avatar, money } from "./ui.js?v=26";
import { Dashboard } from "./dashboard.js?v=26";
import { SharedMap } from "./sharedmap.js?v=26";
import { Overview } from "./overview.js?v=26";
import { DataPage } from "./datatable.js?v=26";
import { CRMPage } from "./crm.js?v=26";
import { IssuesPage } from "./issues.js?v=26";
import { UpNextPage } from "./upnext.js?v=26";

/* Collide Admin — desktop console for owners & facilitators.
   Same Supabase project as the mobile app: everything managed here shows up
   in members' apps live (realtime). Access = a row in the `staff` table. */

const cfg = window.CA_CONFIG || {};
const client = (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY)
  ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
  : null;
window.CA = { client };   // debug/test hook

/* ---- console error telemetry ----
   Report our own uncaught errors into the same client_errors table the app
   feeds and the Issues page reads, tagged source:"console" so the two are
   told apart. Only reports while signed in (RLS needs an authed session);
   throttled + de-duped so one broken render can't flood the table. */
const CONSOLE_VER = "console-" + (document.querySelector('script[src*="app.js"]')?.src.match(/v=(\d+)/)?.[1] || "?");
(() => {
  if (!client) return;
  const seen = new Map(); let sent = 0; const CAP = 20;
  const report = async (message, stack, source) => {
    try {
      message = String(message || "").slice(0, 500);
      if (!message || /ResizeObserver loop/.test(message)) return;   // benign browser noise
      const key = source + "|" + message.slice(0, 120);
      const now = Date.now();
      if (seen.get(key) > now - 60000) return;   // same error, within a minute → skip
      seen.set(key, now);
      if (sent >= CAP) return;                    // hard cap per page load
      sent++;
      const { data } = await client.auth.getSession();
      if (!data.session) return;                  // RLS: authenticated only
      await client.from("client_errors").insert({
        profile_id: data.session.user.id,
        url: location.href.slice(0, 300),
        message, stack: (stack || "").slice(0, 4000),
        source, ua: navigator.userAgent, ver: CONSOLE_VER,
      });
    } catch { /* telemetry must never throw */ }
  };
  window.addEventListener("error", (e) => report(e.message, e.error?.stack, "console:window.onerror"));
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    report(r?.message || String(r), r?.stack, "console:unhandledrejection");
  });
  window.CA.report = report;   // manual hook for caught errors
})();

/* Three worlds: Overview (platform-level, every community), Dashboard (ONE
   community's slice — exactly what a facilitator gets when they log in,
   toggled by the community picker), and the shared Map (app-wide). All the
   facilitator sections live as tabs inside Dashboard. */
const PAGES = ["overview", "dashboard", "map", "upnext", "data", "crm", "issues"];
const PAGE_LABEL = { overview: "Overview", dashboard: "Dashboard", map: "Map", data: "Data", crm: "CRM", issues: "Issues", upnext: "Up Next" };
const DASH_SUBS = ["announcements", "events", "members", "money", "settings", "partnerships"];
const DATA_SUBS = ["communities", "announcements", "events", "members", "invites", "bans"];
const CRM_SUBS = ["funnel", "campaigns", "activity"];

const routeNow = () => {
  const parts = (location.hash || "").replace(/^#\/?/, "").split("/");
  let p = parts[0] || "", sub = parts[1] || "";
  if (DASH_SUBS.includes(p)) { sub = p; p = "dashboard"; }   // legacy top-level links
  if (!PAGES.includes(p)) return { page: "overview", sub: "" };
  const subs = p === "dashboard" ? DASH_SUBS : p === "data" ? DATA_SUBS : p === "crm" ? CRM_SUBS : [];
  return { page: p, sub: subs.includes(sub) ? sub : "" };
};

/* ---- web push: the console is itself a push client ---- */
const VAPID_PUBLIC = "BI1Xp1ZvZNopnjJcUYUl7ZoK99SlCzIkq8yXGo3FT0tJALblL1EkseSrZKzixa-kIxYBviIQsA6QTV_-F_e5Ttg";
const b64ToU8 = (s) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

function PushBell({ session, flash }) {
  const [state, setState] = useState("checking");   // checking | unsupported | off | on | busy
  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) { setState("unsupported"); return; }
      const reg = await navigator.serviceWorker.register("sw.js");
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);
  const toggle = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (state === "on") {
        const sub = await reg.pushManager.getSubscription();
        if (sub) { await client.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
        setState("off"); flash("Push notifications off");
        return;
      }
      setState("busy");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState("off"); flash("Notifications blocked by the browser"); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID_PUBLIC) });
      const j = sub.toJSON();
      const { error } = await client.from("push_subscriptions").upsert({
        profile_id: session.user.id, endpoint: sub.endpoint,
        p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent,
      }, { onConflict: "endpoint" });
      if (error) throw error;
      setState("on"); flash("Push on — announcements will reach this device 🔔");
    } catch (e) { setState("off"); flash(e.message || String(e)); }
  };
  if (state === "checking" || state === "unsupported") return null;
  return html`<button class="linkbtn" disabled=${state === "busy"} onClick=${toggle}
    title=${state === "on" ? "Push is on — click to turn off" : "Turn on push notifications"}
    style=${"text-decoration:none;font-size:16px;padding:0;opacity:" + (state === "on" ? "1" : ".4")}>🔔</button>`;
}

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
  const [route, setRoute] = useState(routeNow());
  const page = route.page;
  const [profile, setProfile] = useState(null);
  const [toast, setToast] = useState("");

  const flash = useCallback((m) => { setToast(m); setTimeout(() => setToast(""), 2200); }, []);

  /* ---- auth ---- */
  useEffect(() => {
    if (!client) return;
    // facilitator emails link here with a token hash — verify it right in the
    // console (redirect-based links get rewritten to the app's site URL)
    const th = location.hash.match(/th=([^&]+)(?:&tt=([a-z_]+))?/);
    if (th) {
      history.replaceState(null, "", location.pathname);
      client.auth.verifyOtp({ token_hash: th[1], type: th[2] || "magiclink" })
        .then(({ error }) => { if (error) setAuthErr("That sign-in link expired — request a fresh one below. (" + error.message + ")"); });
    }
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
      // owners see every community; facilitators only the ones on their staff rows
      const owner = mine.some((s) => s.role === "owner");
      const scoped = owner ? (comms || [])
        : (comms || []).filter((c) => mine.some((s) => s.community_id === null || s.community_id === c.id));
      setCommunities(scoped);
      const saved = localStorage.getItem("ca.comm");
      const living = scoped.filter((c) => !c.archived_at);
      if (saved && scoped.some((c) => c.id === saved)) setCommId(saved);
      else if (living.length) setCommId(living[0].id);
      else if (scoped.length) setCommId(scoped[0].id);
      const { data: prof } = await client.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
      if (live) setProfile(prof || null);
    })();
    return () => { live = false; };
  }, [session?.user?.id]);

  /* ---- routing ---- */
  useEffect(() => {
    const onHash = () => setRoute(routeNow());
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

  return html`<div class="shell">
    <div class="topbar">
      <span class="wordmark" onClick=${() => go("overview")} title="All communities" style="cursor:pointer">collide</span>
      <div class="nav">
        ${PAGES.filter((p) => (p !== "data" && p !== "crm") || isOwner).map((p) => html`<button class=${page === p ? "on" : ""} onClick=${() => go(p)}>${PAGE_LABEL[p]}</button>`)}
      </div>
      ${page === "dashboard" && barTotal != null && html`<span class="money">${money(barTotal)}</span>`}
      ${page === "dashboard" && communities.length > 0 && html`<select class="commselect" value=${commId} onChange=${(e) => pickComm(e.target.value)} title="Viewing this community's slice — how its facilitators see the platform">
        ${communities.filter((c) => !c.archived_at || c.id === commId).map((c) => html`<option value=${c.id}>${c.archived_at ? "🗂 " : ""}${c.name}</option>`)}
      </select>`}
      <${PushBell} session=${session} flash=${flash} />
      <${Avatar} profile=${profile || { display_name: session.user.email }} />
      <button class="linkbtn tiny" onClick=${signOut}>sign out</button>
    </div>
    <div class="main">
      ${page === "overview"
        ? html`<${Overview} ...${ctx} />`    /* platform level — every community, never toggled */
        : page === "map"
        ? html`<${SharedMap} ...${ctx} />`   /* the shared map is app-wide, no community needed */
        : page === "data"
        ? (isOwner
          ? html`<${DataPage} ...${ctx} sub=${route.sub} />`  /* god view — owners only */
          : html`<div class="empty">The Data tables are owner-only.</div>`)
        : page === "crm"
        ? (isOwner
          ? html`<${CRMPage} ...${ctx} sub=${route.sub} />`   /* funnel + drips — owners only */
          : html`<div class="empty">The CRM is owner-only.</div>`)
        : page === "upnext"
        ? html`<${UpNextPage} ...${ctx} />`   /* city journal — staff write stories into the app's Up next */
        : page === "issues"
        ? html`<${IssuesPage} ...${ctx} />`   /* telemetry report — staff-visible, RLS-scoped */
        : !community
        ? html`<div class="empty">No community yet.${isOwner ? " Create one in Settings." : " Ask the owner to assign you to one."}</div>`
        : html`<${Dashboard} ...${ctx} sub=${route.sub} />`}
    </div>
    ${toast && html`<div class="toast">${toast}</div>`}
  </div>`;
}

render(html`<${App} />`, document.getElementById("app"));
