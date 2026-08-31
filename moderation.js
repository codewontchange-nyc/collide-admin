import { useState, useEffect, useMemo, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Avatar, mediaUrl, CITIES, cityName } from "./ui.js?v=32";

/* Moderation — every piece of member content across every city in one feed:
   what was uploaded where, when, and by who. Hide pulls content from all
   member reads instantly (RLS-enforced, reversible); Delete is permanent.
   Owner-only: the content_hidden registry and mod_delete() are owner-gated
   in the database. */

const KINDS = [
  ["all", "All"],
  ["activities", "Events"],
  ["announcements", "Announcements"],
  ["pois", "Map pins"],
  ["yaps", "Yaps"],
  ["community_messages", "Community chat"],
  ["event_messages", "Event chat"],
  ["makers", "Makers"],
];
const KIND_META = {
  activities: { label: "event", icon: "🗓" },
  announcements: { label: "announcement", icon: "📣" },
  pois: { label: "map pin", icon: "📍" },
  yaps: { label: "yap", icon: "💬" },
  community_messages: { label: "community chat", icon: "🏘" },
  event_messages: { label: "event chat", icon: "🎟" },
  makers: { label: "maker profile", icon: "🛠" },
};
const WINDOWS = [["24h", 1], ["7d", 7], ["30d", 30], ["all", 3650]];

const ago = (iso) => {
  if (!iso) return "";
  const m = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

export function ModerationPage({ client, communities, flash }) {
  const [items, setItems] = useState(null);
  const [profiles, setProfiles] = useState(new Map());
  const [kind, setKind] = useState("all");
  const [city, setCity] = useState("all");
  const [status, setStatus] = useState("all");   // all | hidden | visible
  const [mediaOnly, setMediaOnly] = useState(false);
  const [win, setWin] = useState("7d");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(null);   // "tbl:id" while acting

  const commName = useCallback((id) => communities.find((c) => c.id === id)?.name || null, [communities]);

  const load = useCallback(async () => {
    setItems(null);
    const days = WINDOWS.find(([k]) => k === win)?.[1] || 7;
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const [act, ann, poi, yap, cm, em, mk, hid] = await Promise.all([
      client.from("activities").select("id,title,note,image_path,host_id,community_id,city,created_at,visibility").gte("created_at", since).order("created_at", { ascending: false }).limit(500),
      client.from("announcements").select("id,body,author_id,community_id,city,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(500),
      client.from("pois").select("id,name,notes,image_path,images,created_by,community_id,city,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(500),
      client.from("yaps").select("id,body,author_id,city,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(500),
      client.from("community_messages").select("id,body,kind,image_path,audio_path,author_id,community_id,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(500),
      client.from("event_messages").select("id,body,kind,image_path,audio_path,author_id,created_at,activity:activities!event_messages_activity_id_fkey(id,title,city,community_id)").gte("created_at", since).order("created_at", { ascending: false }).limit(500),
      client.from("makers").select("profile_id,headline,bio,gallery,city,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(500),
      client.from("content_hidden").select("*"),
    ]);
    const err = [act, ann, poi, yap, cm, em, mk, hid].find((r) => r.error);
    if (err) { flash(err.error.message); setItems([]); return; }

    const hidden = new Map((hid.data || []).map((h) => [h.tbl + ":" + h.row_id, h]));
    const H = (tbl, id) => hidden.get(tbl + ":" + id) || null;
    const all = [
      ...(act.data || []).map((r) => ({ tbl: "activities", id: r.id, title: r.title, text: r.note, image: r.image_path, author_id: r.host_id, community_id: r.community_id, city: r.city, created_at: r.created_at, extra: r.visibility, hidden: H("activities", r.id) })),
      ...(ann.data || []).map((r) => ({ tbl: "announcements", id: r.id, text: r.body, author_id: r.author_id, community_id: r.community_id, city: r.city, created_at: r.created_at, hidden: H("announcements", r.id) })),
      ...(poi.data || []).map((r) => ({ tbl: "pois", id: r.id, title: r.name, text: r.notes, image: r.image_path || r.images?.[0], author_id: r.created_by, community_id: r.community_id, city: r.city, created_at: r.created_at, hidden: H("pois", r.id) })),
      ...(yap.data || []).map((r) => ({ tbl: "yaps", id: r.id, text: r.body, author_id: r.author_id, city: r.city, created_at: r.created_at, hidden: H("yaps", r.id) })),
      ...(cm.data || []).map((r) => ({ tbl: "community_messages", id: r.id, text: r.body, image: r.image_path, audio: r.audio_path, author_id: r.author_id, community_id: r.community_id, created_at: r.created_at, hidden: H("community_messages", r.id) })),
      ...(em.data || []).map((r) => ({ tbl: "event_messages", id: r.id, text: r.body, image: r.image_path, audio: r.audio_path, author_id: r.author_id, community_id: r.activity?.community_id, city: r.activity?.city, created_at: r.created_at, extra: r.activity?.title ? "in “" + r.activity.title + "”" : null, hidden: H("event_messages", r.id) })),
      ...(mk.data || []).map((r) => ({ tbl: "makers", id: r.profile_id, title: r.headline, text: r.bio, image: r.gallery?.[0], author_id: r.profile_id, city: r.city, created_at: r.created_at, hidden: H("makers", r.profile_id) })),
    ].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    setItems(all);

    const ids = [...new Set(all.map((r) => r.author_id).filter(Boolean))];
    if (ids.length) {
      const { data: profs } = await client.from("profiles").select("id,display_name,avatar_url").in("id", ids);
      setProfiles(new Map((profs || []).map((p) => [p.id, p])));
    }
  }, [client, win]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    let out = items || [];
    if (kind !== "all") out = out.filter((r) => r.tbl === kind);
    if (city !== "all") out = out.filter((r) => r.city === city || (!r.city && city === "all"));
    if (status === "hidden") out = out.filter((r) => r.hidden);
    if (status === "visible") out = out.filter((r) => !r.hidden);
    if (mediaOnly) out = out.filter((r) => r.image || r.audio);
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      out = out.filter((r) => [r.title, r.text, profiles.get(r.author_id)?.display_name, commName(r.community_id)]
        .some((s) => (s || "").toLowerCase().includes(n)));
    }
    return out;
  }, [items, kind, city, status, mediaOnly, q, profiles, commName]);

  const day = new Date(Date.now() - 864e5).toISOString();
  const metrics = [
    ["items", (items || []).length],
    ["uploads", (items || []).filter((r) => r.image || r.audio).length],
    ["hidden", (items || []).filter((r) => r.hidden).length],
    ["last 24h", (items || []).filter((r) => r.created_at > day).length],
  ];

  const hide = async (r) => {
    const reason = prompt(`Hide this ${KIND_META[r.tbl].label} from all members? It stays in the database and can be restored.\n\nReason (optional):`);
    if (reason === null) return;
    setBusy(r.tbl + ":" + r.id);
    const { data: sess } = await client.auth.getSession();
    const { error } = await client.from("content_hidden").insert({ tbl: r.tbl, row_id: r.id, reason: reason || null, hidden_by: sess?.session?.user?.email || null });
    setBusy(null);
    if (error) flash(error.message); else { flash("Hidden from members 🚫"); load(); }
  };
  const restore = async (r) => {
    setBusy(r.tbl + ":" + r.id);
    const { error } = await client.from("content_hidden").delete().eq("tbl", r.tbl).eq("row_id", r.id);
    setBusy(null);
    if (error) flash(error.message); else { flash("Restored — visible to members again ✓"); load(); }
  };
  const destroy = async (r) => {
    if (!confirm(`Permanently DELETE this ${KIND_META[r.tbl].label}? This cannot be undone — hide is the reversible option.`)) return;
    setBusy(r.tbl + ":" + r.id);
    const { error } = await client.rpc("mod_delete", { t: r.tbl, r: r.id });
    setBusy(null);
    if (error) flash(error.message); else { flash("Deleted permanently"); load(); }
  };

  return html`<div class="page">
    <div class="pagehead">
      <h2>Moderation <span class="muted" style="font:400 13px var(--body)">all member content across cities — hide is reversible, delete is not</span></h2>
      <button class="btn small ghost" onClick=${load}>↻ refresh</button>
    </div>

    <div class="dt-metrics">
      ${metrics.map(([l, n]) => html`<div class="metric"><div class="n">${items === null ? "…" : n}</div><div class="l">${l}</div></div>`)}
      <div style="flex:1"></div>
      <input class="dt-search" placeholder="Search content, people, communities…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <div class="subnav" style="margin:0">
        ${WINDOWS.map(([k]) => html`<button class=${win === k ? "on" : ""} onClick=${() => setWin(k)}>${k}</button>`)}
      </div>
    </div>

    <div class="mod-filters">
      <div class="subnav" style="margin:0">
        ${KINDS.map(([k, label]) => html`<button class=${kind === k ? "on" : ""} onClick=${() => setKind(k)}>${label}</button>`)}
      </div>
      <div style="flex:1"></div>
      <select class="commselect" value=${city} onChange=${(e) => setCity(e.target.value)}>
        <option value="all">All cities</option>
        ${CITIES.map(([k, label]) => html`<option value=${k}>${label}</option>`)}
      </select>
      <div class="subnav" style="margin:0">
        ${[["all", "all"], ["visible", "visible"], ["hidden", "🚫 hidden"]].map(([k, l]) =>
          html`<button class=${status === k ? "on" : ""} onClick=${() => setStatus(k)}>${l}</button>`)}
        <button class=${mediaOnly ? "on" : ""} onClick=${() => setMediaOnly(!mediaOnly)}>📷 uploads</button>
      </div>
    </div>

    ${items === null ? html`<div class="empty" style="border:0">Loading everything…</div>`
      : shown.length === 0 ? html`<div class="empty">Nothing matches — clean feed 🧼</div>`
      : shown.map((r) => {
        const meta = KIND_META[r.tbl];
        const p = profiles.get(r.author_id);
        const key = r.tbl + ":" + r.id;
        const img = r.image ? mediaUrl(client, r.image) : null;
        return html`<div class=${"card mod-row" + (r.hidden ? " off" : "")} key=${key}>
          ${img ? html`<img class="mod-thumb" src=${img} alt="" loading="lazy" />` : html`<div class="mod-thumb ph">${meta.icon}</div>`}
          <div style="flex:1;min-width:0">
            <div class="mod-line1">
              <span class="pillstat">${meta.icon} ${meta.label}</span>
              ${r.hidden && html`<span class="pillstat danger" title=${(r.hidden.reason ? "“" + r.hidden.reason + "” — " : "") + (r.hidden.hidden_by || "")}>🚫 hidden</span>`}
              ${r.title && html`<b class="mod-title">${r.title}</b>`}
              ${r.extra && html`<span class="muted tiny">${r.extra}</span>`}
            </div>
            ${r.text && html`<div class="mod-text">${r.text.slice(0, 180)}${r.text.length > 180 ? "…" : ""}</div>`}
            ${r.audio && html`<audio controls preload="none" src=${mediaUrl(client, r.audio)} style="height:28px;max-width:260px"></audio>`}
            <div class="mod-meta">
              ${p ? html`<${Avatar} profile=${p} size="sm" /> <b>${p.display_name || "—"}</b>` : html`<span class="muted">unknown author</span>`}
              ${commName(r.community_id) && html`<span>· ${commName(r.community_id)}</span>`}
              ${r.city && html`<span class="citychip" style="margin:0">${cityName(r.city)}</span>`}
              <span>· ${ago(r.created_at)}</span>
            </div>
          </div>
          <div class="rowactions" style="flex:none">
            ${r.hidden
              ? html`<button class="btn small" disabled=${busy === key} onClick=${() => restore(r)}>Restore</button>`
              : html`<button class="btn small ghost" disabled=${busy === key} onClick=${() => hide(r)}>Hide</button>`}
            <button class="btn small danger" disabled=${busy === key} onClick=${() => destroy(r)}>Delete</button>
          </div>
        </div>`;
      })}
    ${items !== null && items.length >= 500 && html`<p class="tiny muted">Large window — each content type is capped at 500 rows; narrow the window for full coverage.</p>`}
  </div>`;
}
