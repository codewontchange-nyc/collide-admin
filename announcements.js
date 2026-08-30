import { useState, useEffect, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Avatar } from "./ui.js?v=25";

/* The front page's loudest feature, manageable from the desk.
   Facilitators hold ONE live announcement (posting replaces it — the DB
   trigger enforces that); the owner can run several, including globals. */

const ago = (iso) => {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};
const left = (iso) => {
  const m = Math.round((new Date(iso) - Date.now()) / 60000);
  if (m <= 0) return "expired";
  return m < 60 ? `${m}m left` : `${Math.round(m / 60)}h left`;
};

/* Scoped to the community picked in the top bar (the facilitator slice):
   shows that community's announcements plus globals. Owners can still post
   a global from here. */
export function AnnouncementsPage({ client, communities, community, isOwner, session, flash }) {
  const [rows, setRows] = useState(null);   // null = loading
  const [body, setBody] = useState("");
  const [scope, setScope] = useState(community?.id || (isOwner ? "global" : (communities[0]?.id || "")));
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await client.from("announcements")
      .select("*, author:profiles!announcements_author_id_fkey(id,display_name,avatar_url)")
      .order("created_at", { ascending: false }).limit(100);
    const now = Date.now();
    setRows((data || []).filter((a) =>
      (!a.expires_at || new Date(a.expires_at) > now) &&
      (!community || !a.community_id || a.community_id === community.id)));
  }, [client, community?.id]);
  useEffect(() => { load(); }, [load]);

  const cname = (id) => communities.find((c) => c.id === id)?.name || "…";
  const mineLive = (rows || []).some((a) => a.author_id === session.user.id);

  const post = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      const target = communities.find((c) => c.id === scope);
      const { error } = await client.from("announcements").insert({
        body: body.trim(),
        community_id: scope === "global" ? null : scope,
        city: target?.city || "nyc",   // members only see their city's posts
        expires_at: new Date(Date.now() + 48 * 36e5).toISOString(),
      });
      if (error) throw error;
      flash(!isOwner && mineLive ? "Posted — replaced your previous announcement" : "Announcement is live ✨");
      setBody("");
      load();
    } catch (e) { flash(e.message); }
    setBusy(false);
  };

  const remove = async (a) => {
    if (!confirm("Take down this announcement?")) return;
    const { error } = await client.from("announcements").delete().eq("id", a.id);
    if (error) flash(error.message); else { flash("Taken down"); load(); }
  };

  return html`<div class="page">
    <div class="pagehead"><h2 style="margin:0">Announcements</h2>
      <span class="tiny muted">${isOwner ? "You can run several at once." : "You hold one live announcement — posting replaces it."}</span>
    </div>
    <div class="card" style="margin-bottom:18px">
      <textarea class="field area" rows="2" placeholder="Tell the town something…"
        value=${body} onInput=${(e) => setBody(e.target.value)}></textarea>
      <div style="display:flex;gap:10px;align-items:center;margin-top:10px">
        <select class="field" style="max-width:240px" value=${scope} onChange=${(e) => setScope(e.target.value)}>
          ${isOwner && html`<option value="global">🌍 Everyone (global)</option>`}
          ${(community ? [community] : communities).map((c) => html`<option value=${c.id}>${c.name}</option>`)}
        </select>
        <button class="btn" disabled=${busy || !body.trim()} onClick=${post}>
          ${busy ? "Posting…" : (!isOwner && mineLive ? "Replace yours" : "Post")}
        </button>
      </div>
    </div>
    <div class="evlist">
      ${(rows || []).map((a) => html`<div class="evcard">
        <${Avatar} profile=${a.author} />
        <div style="flex:1">
          <div class="d">${a.author?.display_name || "?"} · ${ago(a.created_at)} ·
            <b>${a.community_id ? cname(a.community_id) : "Global"}</b>
            ${a.expires_at && html` · ${left(a.expires_at)}`}</div>
          <div class="t" style="font-weight:500">${a.body}</div>
        </div>
        <div class="rowactions">
          <button class="btn small danger" onClick=${() => remove(a)}>Take down</button>
        </div>
      </div>`)}
      ${rows === null && html`<div class="empty" style="border:0">Loading…</div>`}
      ${rows !== null && rows.length === 0 && html`<div class="empty">Nothing live — the front page is quiet.</div>`}
    </div>
  </div>`;
}
