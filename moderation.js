import { useState, useMemo, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Page, Metrics, Pill, Avatar, Loading, Empty, LoadError, mediaUrl, CITIES, cityName, ago, sinceIso, TIME_WINDOWS, DAY, confirmDanger, promptReason } from "./ui.js?v=__V__";
import { useLoader, COLS, firstError, showError } from "./db.js?v=__V__";

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
  ["dm_messages", "DMs"],
  ["story_comments", "Letter comments"],
  ["hunt_reviews", "Hunt reviews"],
  ["meals", "Meals"],
];
const KIND_META = {
  dm_messages: { label: "direct message", icon: "✉️" },
  story_comments: { label: "letter comment", icon: "🗞" },
  hunt_reviews: { label: "hunt review", icon: "🧭" },
  meals: { label: "meal", icon: "🍲" },
  activities: { label: "event", icon: "🗓" },
  announcements: { label: "announcement", icon: "📣" },
  pois: { label: "map pin", icon: "📍" },
  yaps: { label: "yap", icon: "💬" },
  community_messages: { label: "community chat", icon: "🏘" },
  event_messages: { label: "event chat", icon: "🎟" },
  makers: { label: "maker profile", icon: "🛠" },
};
const CAP = 500;   // per content type, per window

export function ModerationPage({ client, communities, session, flash, query }) {
  // deep links from Data (e.g. a DM thread's "Messages"): #/mod?kind=dm_messages&q=<thread id>
  const link = query || new URLSearchParams((location.hash.split("?")[1] || ""));
  const [kind, setKind] = useState(KINDS.some(([k]) => k === link.get("kind")) ? link.get("kind") : "all");
  const [city, setCity] = useState("all");
  const [status, setStatus] = useState("all");   // all | hidden | visible
  const [mediaOnly, setMediaOnly] = useState(false);
  const [win, setWin] = useState(link.get("q") ? "all" : "7d");
  const [q, setQ] = useState(link.get("q") || "");
  const [busy, setBusy] = useState(null);   // "tbl:id" while acting

  const commName = useCallback((id) => communities.find((c) => c.id === id)?.name || null, [communities]);

  const { data, error, reload } = useLoader(async () => {
    const days = TIME_WINDOWS.find(([k]) => k === win)?.[1] || 7;
    const since = sinceIso(days);
    const recent = (q) => q.gte("created_at", since).order("created_at", { ascending: false }).limit(CAP);
    const [act, ann, poi, yap, cm, em, mk, dm, sc, hr, ml, hid] = await Promise.all([
      recent(client.from("activities").select("id,title,note,image_path,host_id,community_id,city,created_at,visibility")),
      recent(client.from("announcements").select("id,body,author_id,community_id,city,created_at")),
      recent(client.from("pois").select("id,name,notes,image_path,images,created_by,community_id,city,created_at")),
      recent(client.from("yaps").select("id,body,author_id,city,created_at")),
      recent(client.from("community_messages").select("id,body,kind,image_path,audio_path,author_id,community_id,created_at")),
      recent(client.from("event_messages").select("id,body,kind,image_path,audio_path,author_id,created_at,activity:activities!event_messages_activity_id_fkey(id,title,city,community_id)")),
      recent(client.from("makers").select("profile_id,headline,bio,gallery,city,created_at")),
      recent(client.from("dm_messages").select("id,body,kind,author_id,thread_id,created_at")),
      recent(client.from("story_comments").select("id,body,quote,author_id,created_at,story:stories!story_comments_story_id_fkey(id,title,city)")),
      recent(client.from("hunt_reviews").select("id,body,profile_id,activity_id,created_at")),
      recent(client.from("meals").select("id,title,cook_id,community_id,city,status,created_at")),
      client.from("content_hidden").select("tbl,row_id,reason,hidden_by"),
    ]);
    const err = firstError([act, ann, poi, yap, cm, em, mk, dm, sc, hr, ml, hid]); if (err) return { error: err };

    const hidden = new Map((hid.data || []).map((h) => [h.tbl + ":" + h.row_id, h]));
    const H = (tbl, id) => hidden.get(tbl + ":" + id) || null;
    const items = [
      ...(act.data || []).map((r) => ({ tbl: "activities", id: r.id, title: r.title, text: r.note, image: r.image_path, author_id: r.host_id, community_id: r.community_id, city: r.city, created_at: r.created_at, extra: r.visibility, hidden: H("activities", r.id) })),
      ...(ann.data || []).map((r) => ({ tbl: "announcements", id: r.id, text: r.body, author_id: r.author_id, community_id: r.community_id, city: r.city, created_at: r.created_at, hidden: H("announcements", r.id) })),
      ...(poi.data || []).map((r) => ({ tbl: "pois", id: r.id, title: r.name, text: r.notes, image: r.image_path || r.images?.[0], author_id: r.created_by, community_id: r.community_id, city: r.city, created_at: r.created_at, hidden: H("pois", r.id) })),
      ...(yap.data || []).map((r) => ({ tbl: "yaps", id: r.id, text: r.body, author_id: r.author_id, city: r.city, created_at: r.created_at, hidden: H("yaps", r.id) })),
      ...(cm.data || []).map((r) => ({ tbl: "community_messages", id: r.id, text: r.body, image: r.image_path, audio: r.audio_path, author_id: r.author_id, community_id: r.community_id, created_at: r.created_at, hidden: H("community_messages", r.id) })),
      ...(em.data || []).map((r) => ({ tbl: "event_messages", id: r.id, text: r.body, image: r.image_path, audio: r.audio_path, author_id: r.author_id, community_id: r.activity?.community_id, city: r.activity?.city, created_at: r.created_at, extra: r.activity?.title ? "in “" + r.activity.title + "”" : null, hidden: H("event_messages", r.id) })),
      ...(mk.data || []).map((r) => ({ tbl: "makers", id: r.profile_id, title: r.headline, text: r.bio, image: r.gallery?.[0], author_id: r.profile_id, city: r.city, created_at: r.created_at, hidden: H("makers", r.profile_id) })),
      ...(dm.data || []).map((r) => ({ tbl: "dm_messages", id: r.id, thread_id: r.thread_id, text: r.kind === "text" || !r.kind ? r.body : "[" + r.kind + "] " + (r.body || ""), author_id: r.author_id, created_at: r.created_at, extra: "direct message", hidden: H("dm_messages", r.id) })),
      ...(sc.data || []).map((r) => ({ tbl: "story_comments", id: r.id, text: (r.quote ? "“" + r.quote + "” — " : "") + (r.body || ""), author_id: r.author_id, city: r.story?.city, created_at: r.created_at, extra: r.story?.title ? "on “" + r.story.title + "”" : null, hidden: H("story_comments", r.id) })),
      ...(hr.data || []).map((r) => ({ tbl: "hunt_reviews", id: r.id, text: r.body, author_id: r.profile_id, created_at: r.created_at, extra: "hunt review", hidden: H("hunt_reviews", r.id) })),
      ...(ml.data || []).map((r) => ({ tbl: "meals", id: r.id, title: r.title, author_id: r.cook_id, community_id: r.community_id, city: r.city, created_at: r.created_at, extra: r.status, hidden: H("meals", r.id) })),
    ].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    const ids = [...new Set(items.map((r) => r.author_id).filter(Boolean))];
    const profs = ids.length ? await client.from("profiles").select(COLS.profileMin).in("id", ids) : { data: [] };
    const capped = [act, ann, poi, yap, cm, em, mk, dm, sc, hr, ml].some((r) => (r.data || []).length >= CAP);
    return { data: { items, capped, profiles: new Map((profs.data || []).map((p) => [p.id, p])) } };
  }, [client, win], { flash, where: "Moderation" });
  const loading = data === null;
  const d = data && !Array.isArray(data) ? data : { items: [], capped: false, profiles: new Map() };

  const shown = useMemo(() => {
    let out = d.items;
    if (kind !== "all") out = out.filter((r) => r.tbl === kind);
    if (city !== "all") out = out.filter((r) => r.city === city);
    if (status === "hidden") out = out.filter((r) => r.hidden);
    if (status === "visible") out = out.filter((r) => !r.hidden);
    if (mediaOnly) out = out.filter((r) => r.image || r.audio);
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      out = out.filter((r) => [r.title, r.text, d.profiles.get(r.author_id)?.display_name, commName(r.community_id), r.thread_id, r.id]
        .some((s) => (s || "").toLowerCase().includes(n)));
    }
    return out;
  }, [d, kind, city, status, mediaOnly, q, commName]);

  const day = new Date(Date.now() - DAY).toISOString();
  const key = (r) => r.tbl + ":" + r.id;
  const act = async (r, label, run) => {
    setBusy(key(r));
    const { error: e } = await run();
    setBusy(null);
    if (e) showError(flash, label, e); else reload();
  };
  const hide = async (r) => {
    const reason = promptReason(`Hide this ${KIND_META[r.tbl].label} from all members? It stays in the database and can be restored.\n\nReason (optional):`);
    if (reason === null) return;
    await act(r, "Hide", async () => {
      const res = await client.from("content_hidden").insert({ tbl: r.tbl, row_id: r.id, reason: reason || null, hidden_by: session?.user?.email || null });
      if (!res.error) flash("Hidden from members 🚫");
      return res;
    });
  };
  const restore = (r) => act(r, "Restore", async () => { const res = await client.from("content_hidden").delete().eq("tbl", r.tbl).eq("row_id", r.id); if (!res.error) flash("Restored — visible to members again ✓"); return res; });
  const destroy = async (r) => {
    if (!confirmDanger(`Permanently DELETE this ${KIND_META[r.tbl].label}? This cannot be undone — hide is the reversible option.`)) return;
    await act(r, "Delete", async () => { const res = await client.rpc("mod_delete", { t: r.tbl, r: r.id }); if (!res.error) flash("Deleted permanently"); return res; });
  };

  return html`<${Page} title="Moderation" sub="all member content across cities — hide is reversible, delete is not"
    actions=${html`<button class="btn sm ghost" onClick=${reload}>↻ refresh</button>`}>
    <div class="dt-metrics">
      <${Metrics} size="sm" loading=${loading} items=${[
        ["items", d.capped ? `${d.items.length}+` : d.items.length],
        ["uploads", d.items.filter((r) => r.image || r.audio).length],
        ["hidden", d.items.filter((r) => r.hidden).length],
        ["last 24h", d.items.filter((r) => r.created_at > day).length],
      ]} />
      <div class="u-grow"></div>
      <input class="dt-search" placeholder="Search content, people, communities…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <div class="chips">
        ${TIME_WINDOWS.map(([k]) => html`<button class="chip" aria-pressed=${win === k ? "true" : "false"} onClick=${() => setWin(k)}>${k}</button>`)}
      </div>
    </div>

    <div class="mod-filters">
      <div class="chips">
        ${KINDS.map(([k, label]) => html`<button class="chip" aria-pressed=${kind === k ? "true" : "false"} onClick=${() => setKind(k)}>${label}</button>`)}
      </div>
      <div class="u-grow"></div>
      <select class="commselect" value=${city} onChange=${(e) => setCity(e.target.value)}>
        <option value="all">All cities</option>
        ${CITIES.map(([k, label]) => html`<option value=${k}>${label}</option>`)}
      </select>
      <div class="chips">
        ${[["all", "all"], ["visible", "visible"], ["hidden", "🚫 hidden"]].map(([k, l]) =>
          html`<button class="chip" aria-pressed=${status === k ? "true" : "false"} onClick=${() => setStatus(k)}>${l}</button>`)}
        <button class="chip" aria-pressed=${mediaOnly ? "true" : "false"} onClick=${() => setMediaOnly(!mediaOnly)}>📷 uploads</button>
      </div>
    </div>

    ${error ? html`<${LoadError} what="member content" error=${error} onRetry=${reload} />`
      : loading ? html`<${Loading} label="Loading everything…" />`
      : shown.length === 0 ? html`<${Empty}>Nothing matches — clean feed 🧼</${Empty}>`
      : shown.map((r) => {
        const meta = KIND_META[r.tbl];
        const p = d.profiles.get(r.author_id);
        const k = key(r);
        const img = r.image ? mediaUrl(client, r.image) : null;
        return html`<div class=${"inset mod-row" + (r.hidden ? " off" : "")} key=${k}>
          ${img ? html`<img class="mod-thumb" src=${img} alt="" loading="lazy" />` : html`<div class="mod-thumb ph">${meta.icon}</div>`}
          <div class="u-grow">
            <div class="mod-line1">
              <${Pill} tone="neutral">${meta.icon} ${meta.label}</${Pill}>
              ${r.hidden && html`<${Pill} tone="bad" title=${(r.hidden.reason ? "“" + r.hidden.reason + "” — " : "") + (r.hidden.hidden_by || "")}>🚫 hidden</${Pill}>`}
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
          <div class="rowactions">
            ${r.hidden
              ? html`<button class="btn sm" disabled=${busy === k} onClick=${() => restore(r)}>Restore</button>`
              : html`<button class="btn sm ghost" disabled=${busy === k} onClick=${() => hide(r)}>Hide</button>`}
            <button class="btn sm danger" disabled=${busy === k} onClick=${() => destroy(r)}>Delete</button>
          </div>
        </div>`;
      })}
    ${d.capped && html`<p class="tiny muted">Large window — each content type is capped at ${CAP} rows; narrow the window for full coverage.</p>`}
  </${Page}>`;
}
