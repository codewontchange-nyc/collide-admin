import { useState } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Avatar, Pill, Metrics, Loading, Empty, LoadError, cityName, shortDate, fullDate, ago, niceTime, moneyExact, promptReason, isExpired, todayStr, initials, hueFor } from "./ui.js?v=__V__";
import { useLoader, countOf, sendModerate, showError, storageUrl, BUCKETS, COLS } from "./db.js?v=__V__";
import { hrefOf } from "./routes.js?v=__V__";

/* Person — one member, everything we know, on one page. Reached from any
   name in Data (#/data/people?u=<id>). The hero pairs the drawn avatar the
   app shows with the photo it was drawn from: two circles, illustration in
   front on the left, photo behind on the right — the Collide lockup. */

export const personHref = (id) => hrefOf("data", "people", { u: id });
const PHOTO = /\.(jpe?g|png|webp|heic|gif)$/i;
const SOCIAL_URL = { instagram: (h) => `https://instagram.com/${h}`, tiktok: (h) => `https://tiktok.com/@${h}`, x: (h) => `https://x.com/${h}`, twitter: (h) => `https://x.com/${h}`, linkedin: (h) => (h.startsWith("http") ? h : `https://linkedin.com/in/${h}`), website: (h) => (h.startsWith("http") ? h : `https://${h}`) };
const STAGE = ["invited", "signed up", "joined & RSVP'd", "in a circle", "yapping"];   // crm.js STAGES, lower-case
const over = (a) => (a.expires_at ? isExpired(a.expires_at) : !!a.date && a.date < todayStr());
const handle = (h) => String(h || "").replace(/^@/, "").replace(/^https?:\/\/(www\.)?[^/]+\/(@)?/, "");

export function PersonPage({ client, communities, flash, go, id }) {
  const [showAll, setShowAll] = useState(false);
  const { data: d, error, reload } = useLoader(async () => {
    const or = (a, b) => `${a}.eq.${id},${b}.eq.${id}`;
    const [prof, files, mem, rsv, conn, yaps, stories, staff, bans, maker, fac, crm, dms, bookings, hosted, invites, cmsg, emsg] = await Promise.all([
      client.from("profiles").select(COLS.profile + ",connect_code,allergies").eq("id", id).maybeSingle(),
      client.storage.from("avatars").list(id, { limit: 100, sortBy: { column: "created_at", order: "desc" } }),
      client.from("community_members").select("community_id,status,joined_at").eq("profile_id", id).order("joined_at"),
      client.from("rsvps").select("status,created_at,activity:activities(id,title,date,starts_at,expires_at,community_id,city,host_id)").eq("profile_id", id).order("created_at", { ascending: false }).limit(300),
      client.from("connections").select("a,b,status,created_at,requested_by").or(or("a", "b")),
      client.from("yaps").select("id,body,created_at,city,audience").eq("author_id", id).order("created_at", { ascending: false }).limit(8),
      client.from("stories").select("id,title,published,city,created_at").eq("author_id", id).order("created_at", { ascending: false }).limit(8),
      client.from("staff").select(COLS.staff).eq("profile_id", id),
      client.from("bans").select("id,reason,created_at").eq("profile_id", id),
      client.from("makers").select("headline,offers,active,city,price_cents,booking_mode,trial_ends_at").eq("profile_id", id).maybeSingle(),
      client.from("facilitators").select("community_id,headline,active").eq("profile_id", id),
      client.rpc("person_stage", { uid: id }).maybeSingle(),
      countOf(client, "dm_threads", (q) => q.or(or("starter_id", "owner_id"))),
      countOf(client, "bookings", (q) => q.or(or("booker_id", "maker_id"))),
      client.from("activities").select("id,title,date,starts_at,community_id,city").eq("host_id", id).order("date", { ascending: false }).limit(50),
      countOf(client, "invites", (q) => q.eq("invited_by", id)),
      countOf(client, "community_messages", (q) => q.eq("author_id", id)),
      countOf(client, "event_messages", (q) => q.eq("author_id", id)),
    ]);
    if (prof.error) return { error: prof.error };
    if (!prof.data) return { error: { message: "No such person" } };
    const photoFile = (files.data || []).find((f) => PHOTO.test(f.name));
    const others = [...new Set((conn.data || []).map((c) => (c.a === id ? c.b : c.a)))];
    const { data: circleProfiles } = others.length ? await client.from("profiles").select(COLS.profileMin).in("id", others) : { data: [] };
    const byId = new Map((circleProfiles || []).map((p) => [p.id, p]));
    return { data: {
      p: prof.data, photo: photoFile ? storageUrl(BUCKETS.avatars, `${id}/${photoFile.name}`) : null,
      memberships: mem.data || [], rsvps: (rsv.data || []).filter((r) => r.activity),
      circle: (conn.data || []).map((c) => ({ ...c, other: byId.get(c.a === id ? c.b : c.a) || { id: c.a === id ? c.b : c.a } })),
      yaps: yaps.data || [], stories: stories.data || [], staff: staff.data || [], bans: bans.data || [], maker: maker.data, facilitators: fac.data || [], crm: crm.data,
      dms: dms.count, bookings: bookings.count, hosted: hosted.data || [], invites: invites.count, messages: (cmsg.count || 0) + (emsg.count || 0),
    } };
  }, [client, id], { flash, where: "Person" });

  const ban = async () => {
    const who = d.p.display_name || "this user";
    const reason = promptReason(`Ban ${who} from ALL of Collide?\n\nThey are signed out, can't sign back in, lose every membership, and can't be re-invited. Type a reason to confirm:`);
    if (reason === null || !reason.trim()) return;
    const res = await sendModerate(client, { action: "ban", profile_id: id, reason: reason.trim() });
    if (res.error) showError(flash, "Ban", res.error); else { flash(`Banned ${who} 🔨`); reload(); }
  };
  const comm = (cid) => communities.find((c) => c.id === cid);
  const commName = (cid) => (cid ? (comm(cid)?.name || "?") : "city-wide");

  if (error) return html`<${LoadError} what="this person" error=${error} onRetry=${reload} />`;
  if (!d) return html`<${Loading} label="Pulling their file…" />`;
  const { p } = d;
  const name = p.display_name || "Unnamed";
  const ink = p.avatar_url ? storageUrl(BUCKETS.avatars, p.avatar_url) : null;
  const banned = d.bans.length > 0;
  const members = d.memberships.filter((m) => m.status === "member");
  const accepted = d.circle.filter((c) => c.status === "accepted");
  const upcoming = d.rsvps.filter((r) => !over(r.activity)).sort((a, b) => (a.activity.date || "").localeCompare(b.activity.date || ""));
  const past = d.rsvps.filter((r) => over(r.activity));
  const socials = Object.entries(p.socials || {}).filter(([, v]) => v);

  return html`<div class="person">
    <button class="btn link tiny" onClick=${() => go("data/people")}>← People</button>
    <div class="person-hero">
      <div class="lockup" title=${d.photo ? "Drawn from this photo" : "No photo on file — the drawing was made by hand"}>
        ${d.photo ? html`<img class="photo" src=${d.photo} alt="" />` : html`<div class="photo ph">no photo<br/>on file</div>`}
        ${ink ? html`<img class="ink" src=${ink} alt=${name} />` : html`<div class="ink ph big" style=${`background:${hueFor(name)}`}>${initials(name)}</div>`}
      </div>
      <div class="u-grow" style="min-width:0">
        <h3 class="person-name">${name}</h3>
        <div class="u-row u-wrap" style="gap:6px;margin-bottom:8px">
          ${banned && html`<${Pill} tone="bad">banned</${Pill}>`}
          ${d.staff.map((s) => html`<${Pill} tone="warn" title=${s.email}>${s.role}${s.community_id ? " · " + commName(s.community_id) : ""}</${Pill}>`)}
          ${d.maker && html`<${Pill} tone=${d.maker.active ? "ok" : "neutral"}>maker${d.maker.active ? "" : " · paused"}</${Pill}>`}
          ${d.facilitators.map((f) => html`<${Pill} tone=${f.active ? "ok" : "neutral"}>facilitator · ${commName(f.community_id)}</${Pill}>`)}
          ${d.crm && html`<${Pill} tone="neutral" title=${d.crm.stage_entered_at ? "since " + fullDate(d.crm.stage_entered_at) : ""}>${STAGE[d.crm.stage] || "stage " + d.crm.stage}</${Pill}>`}
          ${p.crm_opt_out && html`<${Pill} tone="neutral">no marketing</${Pill}>`}
        </div>
        <div class="tiny muted person-facts">
          <span>${p.home_city ? "🏠 " + cityName(p.home_city) : "no home city"}</span>
          <span>joined ${fullDate(p.created_at)} · ${ago(p.created_at)}</span>
          ${d.crm?.last_sign_in_at && html`<span>last seen ${ago(d.crm.last_sign_in_at)}</span>`}
          ${p.phone && html`<span>📞 ${p.phone}</span>`}
          ${p.connect_code && html`<span>code <b>${p.connect_code}</b></span>`}
          ${socials.map(([k, v]) => html`<span>${SOCIAL_URL[k] ? html`<a href=${SOCIAL_URL[k](handle(v))} target="_blank" rel="noopener">${k} · @${handle(v)}</a>` : `${k} · ${v}`}</span>`)}
          ${(p.allergies || []).length > 0 && html`<span>allergies: ${p.allergies.join(", ")}</span>`}
        </div>
      </div>
      <div class="u-col" style="gap:6px;align-items:flex-end">
        ${!banned && html`<button class="btn sm danger" onClick=${ban}>Ban</button>`}
        <span class="tiny muted" title=${p.id}>${p.id.slice(0, 8)}</span>
      </div>
    </div>

    <${Metrics} size="sm" items=${[["communities", members.length], ["events", d.rsvps.length], ["hosted", d.hosted.length], ["circle", accepted.length], ["yaps", d.yaps.length + (d.yaps.length === 8 ? "+" : "")], ["stories", d.stories.length], ["DMs", d.dms], ["messages", d.messages], ["bookings", d.bookings], ["invited", d.invites]]} />

    <div class="person-grid">
      <section>
        <h4>Communities</h4>
        ${d.memberships.length === 0 ? html`<${Empty} bare>Not in a community yet.</${Empty}>`
          : html`<table class="table">${d.memberships.map((m) => html`<tr key=${m.community_id}>
              <td><b>${comm(m.community_id)?.emoji || ""} ${commName(m.community_id)}</b>${comm(m.community_id)?.city ? html` <span class="tiny muted">${cityName(comm(m.community_id).city)}</span>` : ""}</td>
              <td><${Pill} sm tone=${m.status === "member" ? "ok" : "neutral"}>${m.status}</${Pill}></td>
              <td class="tiny muted">${m.joined_at ? ago(m.joined_at) : ""}</td></tr>`)}</table>`}
      </section>

      <section>
        <h4>Events ${d.rsvps.length > 0 && html`<span class="muted">· ${upcoming.length} upcoming · ${past.length} past</span>`}</h4>
        ${d.rsvps.length === 0 ? html`<${Empty} bare>No RSVPs yet.</${Empty}>`
          : html`<table class="table">${[...upcoming, ...(showAll ? past : past.slice(0, 6))].map((r) => html`<tr key=${r.activity.id + r.created_at}>
              <td><b>${r.activity.title}</b><div class="tiny muted">${commName(r.activity.community_id)}${r.activity.host_id === id ? " · hosting" : ""}</div></td>
              <td class="tiny">${shortDate(r.activity.date)}${r.activity.starts_at ? " · " + niceTime(r.activity.starts_at.slice(0, 5)) : ""}</td>
              <td><${Pill} sm tone=${r.status === "going" || r.status === "yes" ? "ok" : "neutral"}>${r.status}</${Pill}></td></tr>`)}</table>
            ${!showAll && past.length > 6 && html`<button class="btn link tiny" onClick=${() => setShowAll(true)}>show all ${past.length} past</button>`}`}
      </section>

      <section>
        <h4>Circle ${d.circle.length > 0 && html`<span class="muted">· ${accepted.length} connected${d.circle.length - accepted.length ? ` · ${d.circle.length - accepted.length} pending` : ""}</span>`}</h4>
        ${d.circle.length === 0 ? html`<${Empty} bare>Nobody in their circle yet.</${Empty}>`
          : html`<div class="u-row u-wrap" style="gap:8px">${d.circle.map((c) => html`<a key=${c.other.id} class=${"who person-chip" + (c.status === "accepted" ? "" : " off")} href=${personHref(c.other.id)} title=${c.status === "accepted" ? "connected " + ago(c.created_at) : c.status + (c.requested_by === id ? " · they asked" : " · asked them")}>
              <${Avatar} profile=${c.other} size="sm" />${c.other.display_name || c.other.id.slice(0, 6)}</a>`)}</div>`}
      </section>

      <section>
        <h4>Yaps</h4>
        ${d.yaps.length === 0 ? html`<${Empty} bare>Hasn't yapped.</${Empty}>`
          : d.yaps.map((y) => html`<div key=${y.id} class="person-item"><div>${y.body}</div><div class="tiny muted">${ago(y.created_at)} · ${cityName(y.city)} · ${y.audience}</div></div>`)}
      </section>

      ${(d.stories.length > 0 || d.hosted.length > 0) && html`<section>
        <h4>Made</h4>
        ${d.hosted.map((a) => html`<div key=${a.id} class="person-item"><b>${a.title}</b> <span class="tiny muted">hosted · ${shortDate(a.date)} · ${commName(a.community_id)}</span></div>`)}
        ${d.stories.map((s) => html`<div key=${s.id} class="person-item"><b>${s.title}</b> <span class="tiny muted">story · ${s.published ? "published" : "draft"} · ${ago(s.created_at)}</span></div>`)}
      </section>`}

      ${d.maker && html`<section>
        <h4>Maker</h4>
        <div><b>${d.maker.headline || "—"}</b></div>
        <div class="tiny muted">${[d.maker.city && cityName(d.maker.city), d.maker.booking_mode, d.maker.price_cents ? moneyExact(d.maker.price_cents) : null, d.maker.trial_ends_at ? "trial ends " + shortDate(d.maker.trial_ends_at) : null].filter(Boolean).join(" · ")}</div>
        ${(d.maker.offers || []).length > 0 && html`<div class="u-row u-wrap u-mt-1" style="gap:4px">${d.maker.offers.map((o) => html`<${Pill} sm>${typeof o === "string" ? o : o.title || o.name || ""}</${Pill}>`)}</div>`}
      </section>`}

      ${banned && html`<section>
        <h4>Ban</h4>
        ${d.bans.map((b) => html`<div key=${b.id} class="person-item"><b>${b.reason || "no reason recorded"}</b><div class="tiny muted">${fullDate(b.created_at)}</div></div>`)}
      </section>`}
    </div>
  </div>`;
}
