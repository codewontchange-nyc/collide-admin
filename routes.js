/* routes.js — the one table of pages, their tabs, and who may see them.
   app.js renders from it, ui.js's <Tabs> reads it, and every page navigates
   through go(). Adding a page = one row here + one entry in app.js's VIEW map. */

export const PAGES = [
  { key: "overview",  label: "Overview" },
  { key: "dashboard", label: "Dashboard", needsCommunity: true,
    tabs: [["", "Dashboard"], ["announcements", "Announcements"], ["events", "Events"], ["members", "Members"],
           ["money", "Money"], ["meals", "Meals"], ["settings", "Settings"], ["partnerships", "Partnerships"]] },
  { key: "map",       label: "Map" },
  { key: "network",   label: "Network", ownerOnly: true },
  { key: "upnext",    label: "Up Next" },
  { key: "canvas",    label: "UX Onboarding" },
  { key: "data",      label: "Data", ownerOnly: true,
    tabs: [["communities", "Communities"], ["people", "People"], ["announcements", "Announcements"], ["events", "Events"],
           ["members", "Memberships"], ["facilitators", "Facilitators"], ["circles", "Circles"], ["dms", "DMs"],
           ["invites", "Invites"], ["bans", "Bans"]] },
  { key: "crm",       label: "CRM", ownerOnly: true,
    tabs: [["funnel", "Funnel"], ["campaigns", "Campaigns"], ["activity", "Activity"]] },
  { key: "scout",     label: "Scout", tabs: [["", "Find"], ["paste", "Paste a link"]] },
  { key: "billing",   label: "Billing", ownerOnly: true },
  { key: "mod",       label: "Moderation", ownerOnly: true },
  { key: "ads",       label: "Ads" },
  { key: "issues",    label: "Issues" },
];
export const PAGE = Object.fromEntries(PAGES.map((p) => [p.key, p]));

// sub-route keys of a page ("" = the page's own home tab, never a sub)
export const tabsOf = (key) => (PAGE[key]?.tabs || []).map(([k]) => k).filter(Boolean);
export const canSee = (key, isOwner) => !PAGE[key]?.ownerOnly || !!isOwner;

// #/page/sub?k=v  — the query part is page-local (Moderation deep links etc.)
export const routeNow = () => {
  const [path, qs] = (location.hash || "").replace(/^#\/?/, "").split("?");
  const parts = path.split("/");
  let p = parts[0] || "", sub = parts[1] || "";
  if (tabsOf("dashboard").includes(p)) { sub = p; p = "dashboard"; }   // legacy top-level links
  const query = new URLSearchParams(qs || "");
  if (!PAGE[p]) return { page: "overview", sub: "", query };
  return { page: p, sub: tabsOf(p).includes(sub) ? sub : "", query };
};

export const go = (path) => { location.hash = "/" + String(path || "").replace(/^\/+/, ""); };
export const hrefOf = (page, sub, params) => {
  const q = params ? "?" + new URLSearchParams(params).toString() : "";
  return "#/" + page + (sub ? "/" + sub : "") + q;
};
