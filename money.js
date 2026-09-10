import { useState } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Modal, Page, Metrics, Pill, Loading, Empty, LoadError, moneyExact, money, niceDate, shortDateTime, todayStr, monthStartStr, toCents, confirmDanger } from "./ui.js?v=__V__";
import { useLoader, paged, inChunks, firstError, showError } from "./db.js?v=__V__";

/* Phase 1 money = display-only: a manual ledger of income (event fees, POI
   partnerships, other), plus computed membership revenue. Stripe comes later.
   Maker bookings (paid straight to makers who are members here) are shown
   beside the ledger, not added to it. */

const KINDS = { membership: "💳 Membership", event: "🎟️ Event", poi: "📍 POI", other: "✨ Other" };
const BOOKING_COLS = "id,maker_id,booker_id,starts_at,ends_at,note,status,pay_mode,amount_cents,paid,created_at";

export function MoneyPage({ client, community, session, flash }) {
  const [adding, setAdding] = useState(false);

  const { data, error, reload } = useLoader(async () => {
    const [led, cnt, mem] = await Promise.all([
      client.from("ledger").select("*").eq("community_id", community.id).order("happened_on", { ascending: false }).limit(400),
      client.from("community_members").select("profile_id", { count: "exact", head: true }).eq("community_id", community.id).eq("status", "member"),
      paged((a, b) => client.from("community_members").select("profile_id").eq("community_id", community.id).neq("status", "pending").range(a, b)),
    ]);
    const err = firstError([led, cnt, mem]); if (err) return { error: err };
    const ids = (mem.data || []).map((m) => m.profile_id);
    const bk = ids.length ? await inChunks(ids, 150, (chunk) => client.from("bookings").select(BOOKING_COLS).in("maker_id", chunk).order("starts_at", { ascending: false }).limit(200)) : { data: [] };
    if (bk.error) return { error: bk.error };
    const who = [...new Set(bk.data.flatMap((b) => [b.maker_id, b.booker_id]).filter(Boolean))];
    const pr = who.length ? await inChunks(who, 150, (c) => client.from("profiles").select("id,display_name").in("id", c)) : { data: [] };
    return { data: { rows: led.data || [], memberCount: cnt.count || 0, bookings: bk.data, names: Object.fromEntries((pr.data || []).map((p) => [p.id, p.display_name || "—"])) } };
  }, [client, community.id], { flash, where: "Money", client, realtime: [{ table: "bookings" }] });

  const loading = data === null;
  const d = data && !Array.isArray(data) ? data : { rows: [], bookings: [], names: {}, memberCount: 0 };
  const monthStart = monthStartStr();
  const monthSum = d.rows.filter((r) => r.happened_on >= monthStart).reduce((a, r) => a + r.amount_cents, 0);
  const membershipMo = d.memberCount * (community.membership_price_cents || 0);
  const bkMonth = d.bookings.filter((b) => b.paid && (b.starts_at || b.created_at) >= monthStart).reduce((a, b) => a + (b.amount_cents || 0), 0);
  const bkUnpaid = d.bookings.filter((b) => !b.paid && !/cancel/.test(b.status || "")).reduce((a, b) => a + (b.amount_cents || 0), 0);

  const remove = async (r) => {
    if (!confirmDanger("Delete this entry?")) return;
    const { error: e } = await client.from("ledger").delete().eq("id", r.id);
    if (e) showError(flash, "Delete", e); else { flash("Deleted"); reload(); }
  };

  return html`<${Page} title="Money" actions=${html`<button class="btn" onClick=${() => setAdding(true)}>+ Log income</button>`}>
    <${Metrics} loading=${loading} items=${[
      ["Memberships / mo", money(membershipMo), { money: true, sub: `${d.memberCount} members × ${moneyExact(community.membership_price_cents || 0)}` }],
      ["Logged this month", money(monthSum), { money: true }],
      ["Total / mo", money(membershipMo + monthSum), { money: true }],
    ]} />
    <p class="tiny muted">Phase 1 is a manual ledger — real payments (Stripe) come later. Membership price is set in Settings.</p>
    ${error ? html`<${LoadError} what="the ledger" error=${error} onRetry=${reload} />`
      : loading ? html`<${Loading} />`
      : d.rows.length === 0 ? html`<${Empty} mt>No income logged yet.</${Empty}>`
      : html`<table class="table">
          <thead><tr><th>Date</th><th>Kind</th><th>Label</th><th class="u-right">Amount</th><th></th></tr></thead>
          <tbody>${d.rows.map((r) => html`<tr>
            <td class="muted">${niceDate(r.happened_on)}</td>
            <td>${KINDS[r.kind] || r.kind}</td>
            <td>${r.label || "—"}</td>
            <td class="amt">${moneyExact(r.amount_cents)}</td>
            <td class="actions"><button class="btn link tiny" onClick=${() => remove(r)}>delete</button></td>
          </tr>`)}</tbody>
        </table>`}

    <div class="section-label u-mt-3">Maker bookings <span class="sub">— paid directly to makers who are members here (not part of the ledger)</span></div>
    <${Metrics} loading=${loading} items=${[
      ["Booked", d.bookings.length],
      ["Paid this month", moneyExact(bkMonth), { money: true }],
      ["Unpaid / open", moneyExact(bkUnpaid), { tone: bkUnpaid ? "warn" : "" }],
    ]} />
    ${!loading && d.bookings.length > 0 && html`<table class="table">
      <thead><tr><th>When</th><th>Maker</th><th>Booked by</th><th>Status</th><th class="u-right">Amount</th><th>Paid</th></tr></thead>
      <tbody>${d.bookings.map((b) => html`<tr>
        <td class="muted">${shortDateTime(b.starts_at || b.created_at)}</td>
        <td><b>${d.names[b.maker_id] || "—"}</b></td>
        <td>${d.names[b.booker_id] || "—"}</td>
        <td><${Pill}>${b.status || "—"}</${Pill}></td>
        <td class="amt" style="color:inherit">${b.amount_cents ? moneyExact(b.amount_cents) : "—"}${b.pay_mode ? html` <span class="muted tiny">${b.pay_mode}</span>` : ""}</td>
        <td>${b.paid ? "✓" : html`<span class="muted">—</span>`}</td>
      </tr>`)}</tbody>
    </table>`}
    ${!loading && !error && d.bookings.length === 0 && html`<p class="tiny muted">No maker bookings for this community's members yet.</p>`}
    ${adding && html`<${AddModal} client=${client} community=${community} session=${session} flash=${flash}
      onClose=${() => setAdding(false)} onSaved=${() => { setAdding(false); reload(); }} />`}
  </${Page}>`;
}

function AddModal({ client, community, session, flash, onClose, onSaved }) {
  const [f, setF] = useState({ kind: "event", label: "", amount: "", happened_on: todayStr() });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    const cents = toCents(f.amount);
    if (!cents) { flash("Enter an amount"); return; }
    const { error } = await client.from("ledger").insert({
      community_id: community.id, kind: f.kind, label: f.label.trim() || null,
      amount_cents: cents, happened_on: f.happened_on, created_by: session.user.id,
    });
    if (error) showError(flash, "Log income", error); else { flash("Logged 💚"); onSaved(); }
  };
  return html`<${Modal} title="Log income" onClose=${onClose}>
    <form onSubmit=${save}>
      <div class="fieldrow">
        <div class="field"><label>Kind</label>
          <select value=${f.kind} onChange=${set("kind")}>${Object.entries(KINDS).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select></div>
        <div class="field"><label>Amount ($)</label><input type="number" min="0" step="0.01" required value=${f.amount} onInput=${set("amount")} /></div>
        <div class="field"><label>Date</label><input type="date" required value=${f.happened_on} onInput=${set("happened_on")} /></div>
      </div>
      <div class="field"><label>Label</label><input value=${f.label} onInput=${set("label")} placeholder="Eagle Rock Hike tickets" /></div>
      <div class="actions">
        <button type="button" class="btn ghost" onClick=${onClose}>Cancel</button>
        <button class="btn">Save</button>
      </div>
    </form>
  </${Modal}>`;
}
