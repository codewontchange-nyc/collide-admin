import { useState } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Page, Avatar, Loading, Empty, LoadError, ago, left, stampCity, confirmDanger } from "./ui.js?v=__V__";
import { useLoader, showError } from "./db.js?v=__V__";

/* The front page's loudest feature, manageable from the desk.
   Facilitators hold ONE live announcement (posting replaces it — the DB
   trigger enforces that); the owner can run several, including globals.

   Scoped to the community picked in the top bar (the facilitator slice):
   shows that community's announcements plus globals. Owners can still post
   a global from here. */
export function AnnouncementsPage({ client, communities, community, isOwner, session, flash }) {
  const [body, setBody] = useState("");
  const [scope, setScope] = useState(community?.id || (isOwner ? "global" : (communities[0]?.id || "")));
  const [busy, setBusy] = useState(false);

  // live ones only, this community's + globals — filtered by the server, not after a capped fetch
  const { data: rows, error, reload } = useLoader(() => {
    let q = client.from("announcements")
      .select("id,body,community_id,author_id,city,created_at,expires_at,author:profiles!announcements_author_id_fkey(id,display_name,avatar_url)")
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("created_at", { ascending: false }).limit(200);
    if (community) q = q.or(`community_id.is.null,community_id.eq.${community.id}`);
    return q;
  }, [client, community?.id], { flash, where: "Announcements" });

  const cname = (id) => communities.find((c) => c.id === id)?.name || "—";
  const mineLive = (rows || []).some((a) => a.author_id === session.user.id);

  const post = async () => {
    if (!body.trim()) return;
    setBusy(true);
    const { error: e } = await client.from("announcements").insert({
      body: body.trim(),
      community_id: scope === "global" ? null : scope,
      city: stampCity(communities, scope),   // members only see their city's posts
      expires_at: new Date(Date.now() + 48 * 36e5).toISOString(),
    });
    if (e) showError(flash, "Post", e);
    else { flash(!isOwner && mineLive ? "Posted — replaced your previous announcement" : "Announcement is live ✨"); setBody(""); reload(); }
    setBusy(false);
  };

  const remove = async (a) => {
    if (!confirmDanger("Take down this announcement?")) return;
    const { error: e } = await client.from("announcements").delete().eq("id", a.id);
    if (e) showError(flash, "Take down", e); else { flash("Taken down"); reload(); }
  };

  return html`<${Page} title="Announcements"
    actions=${html`<span class="tiny muted">${isOwner ? "You can run several at once." : "You hold one live announcement — posting replaces it."}</span>`}>
    <div class="inset" style="margin-bottom:18px">
      <textarea class="field area" rows="2" placeholder="Tell the town something…"
        value=${body} onInput=${(e) => setBody(e.target.value)}></textarea>
      <div class="u-row u-mt-1">
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
        <div class="u-grow">
          <div class="d">${a.author?.display_name || "?"} · ${ago(a.created_at)} ·
            <b>${a.community_id ? cname(a.community_id) : "Global"}</b>
            ${a.expires_at && html` · ${left(a.expires_at)}`}</div>
          <div class="t" style="font-weight:500">${a.body}</div>
        </div>
        <div class="rowactions">
          <button class="btn sm danger" onClick=${() => remove(a)}>Take down</button>
        </div>
      </div>`)}
      ${error ? html`<${LoadError} what="announcements" error=${error} onRetry=${reload} />`
        : rows === null ? html`<${Loading} />`
        : rows.length === 0 && html`<${Empty}>Nothing live — the front page is quiet.</${Empty}>`}
    </div>
  </${Page}>`;
}
