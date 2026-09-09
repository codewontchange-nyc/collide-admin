import { useState, useEffect, useCallback, useMemo } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Modal, moneyExact, money, niceDate, todayStr } from "./ui.js?v=43";

/* Phase 1 money = display-only: a manual ledger of income (event fees, POI
   partnerships, other), plus computed membership revenue. Stripe comes later. */

const KINDS = { membership: "💳 Membership", event: "🎟️ Event", poi: "📍 POI", other: "✨ Other" };

export function MoneyPage({ client, community, session, flash }) {
  const [rows, setRows] = useState(null);   // null = loading
  const [adding, setAdding] = useState(false);
  const [memberCount, setMemberCount] = useState(0);
  const [bookings, setBookings] = useState(null);   // maker bookings where the maker is one of this community's members
  const [names, setNames] = useState({});

  const load = useCallback(async () => {
    const [{ data }, { count }, mem] = await Promise.all([
      client.from("ledger").select("*").eq("community_id", community.id).order("happened_on", { ascending: false }).limit(400),
      client.from("community_members").select("*", { count: "exact", head: true }).eq("community_id", community.id).eq("status", "member"),
      client.from("community_members").select("profile_id").eq("community_id", community.id).neq("status", "pending"),
    ]);
    setRows(data || []); setMemberCount(count || 0);
    const ids = (mem.data || []).map((m) => m.profile_id);
    if (!ids.length) { setBookings([]); return; }
    const { data: bk, error } = await client.from("bookings").select("*").in("maker_id", ids).order("starts_at", { ascending: false }).limit(200);
    if (error) { flash("Bookings: " + error.message); setBookings([]); return; }
    const who = [...new Set((bk || []).flatMap((b) => [b.maker_id, b.booker_id]).filter(Boolean))];
    const { data: profs } = who.length ? await client.from("profiles").select("id,display_name").in("id", who) : { data: [] };
    setNames(Object.fromEntries((profs || []).map((p) => [p.id, p.display_name || "—"])));
    setBookings(bk || []);
  }, [client, community.id]);
  useEffect(() => { load(); }, [load]);

  const monthStart = useMemo(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); }, []);
  const monthSum = (rows || []).filter((r) => r.happened_on >= monthStart).reduce((a, r) => a + r.amount_cents, 0);
  const membershipMo = memberCount * (community.membership_price_cents || 0);
  const bkMonth = (bookings || []).filter((b) => b.paid && (b.starts_at || b.created_at) >= monthStart).reduce((a, b) => a + (b.amount_cents || 0), 0);
  const bkUnpaid = (bookings || []).filter((b) => !b.paid && b.status !== "cancelled").reduce((a, b) => a + (b.amount_cents || 0), 0);
  const when = (iso) => { try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return iso || "—"; } };

  const remove = async (r) => {
    if (!confirm("Delete this entry?")) return;
    const { error } = await client.from("ledger").delete().eq("id", r.id);
    if (error) flash(error.message); else { flash("Deleted"); load(); }
  };

  return html`<div class="page">
    <div class="pagehead">
      <h2 style="margin:0">Money</h2>
      <button class="btn" onClick=${() => setAdding(true)}>+ Log income</button>
    </div>
    <div class="stats" style="grid-template-columns:repeat(3,1fr);max-width:760px">
      <div class="stat"><div class="lab">Memberships / mo</div><div class="num money">${rows === null ? "…" : money(membershipMo)}</div>
        <div class="tiny muted">${memberCount} members × ${moneyExact(community.membership_price_cents || 0)}</div></div>
      <div class="stat"><div class="lab">Logged this month</div><div class="num money">${rows === null ? "…" : money(monthSum)}</div></div>
      <div class="stat"><div class="lab">Total / mo</div><div class="num money">${rows === null ? "…" : money(membershipMo + monthSum)}</div></div>
    </div>
    <p class="tiny muted">Phase 1 is a manual ledger — real payments (Stripe) come later. Membership price is set in Settings.</p>
    <table class="table">
      <thead><tr><th>Date</th><th>Kind</th><th>Label</th><th style="text-align:right">Amount</th><th></th></tr></thead>
      <tbody>
        ${(rows || []).map((r) => html`<tr>
          <td class="muted">${niceDate(r.happened_on)}</td>
          <td>${KINDS[r.kind] || r.kind}</td>
          <td>${r.label || "—"}</td>
          <td style="text-align:right;font-weight:600;color:var(--green)">${moneyExact(r.amount_cents)}</td>
          <td class="rowactions"><button class="linkbtn tiny" onClick=${() => remove(r)}>delete</button></td>
        </tr>`)}
      </tbody>
    </table>
    ${rows === null && html`<div class="empty" style="border:0;margin-top:12px">Loading…</div>`}
    ${rows !== null && rows.length === 0 && html`<div class="empty" style="margin-top:12px">No income logged yet.</div>`}

    <div class="section-label" style="margin-top:34px">Maker bookings <span class="muted" style="font:400 12px var(--body)">— paid directly to makers who are members here (not part of the ledger)</span></div>
    <div class="stats" style="grid-template-columns:repeat(3,1fr);max-width:760px">
      <div class="stat"><div class="lab">Booked</div><div class="num">${bookings === null ? "…" : bookings.length}</div></div>
      <div class="stat"><div class="lab">Paid this month</div><div class="num money">${bookings === null ? "…" : moneyExact(bkMonth)}</div></div>
      <div class="stat"><div class="lab">Unpaid / open</div><div class="num" style="color:#6d682f">${bookings === null ? "…" : moneyExact(bkUnpaid)}</div></div>
    </div>
    ${bookings !== null && bookings.length > 0 && html`<table class="table">
      <thead><tr><th>When</th><th>Maker</th><th>Booked by</th><th>Status</th><th style="text-align:right">Amount</th><th>Paid</th></tr></thead>
      <tbody>
        ${bookings.map((b) => html`<tr>
          <td class="muted">${when(b.starts_at || b.created_at)}</td>
          <td><b>${names[b.maker_id] || "—"}</b></td>
          <td>${names[b.booker_id] || "—"}</td>
          <td><span class=${"pillstat " + (b.status === "confirmed" ? "member" : b.status === "cancelled" ? "danger" : "pending")}>${b.status || "—"}</span></td>
          <td style="text-align:right;font-weight:600">${b.amount_cents ? moneyExact(b.amount_cents) : "—"}${b.pay_mode ? html` <span class="muted tiny">${b.pay_mode}</span>` : ""}</td>
          <td>${b.paid ? "✓" : html`<span class="muted">—</span>`}</td>
        </tr>`)}
      </tbody>
    </table>`}
    ${bookings !== null && bookings.length === 0 && html`<p class="tiny muted">No maker bookings for this community's members yet.</p>`}
    ${adding && html`<${AddModal} client=${client} community=${community} session=${session} flash=${flash}
      onClose=${() => setAdding(false)} onSaved=${() => { setAdding(false); load(); }} />`}
  </div>`;
}

function AddModal({ client, community, session, flash, onClose, onSaved }) {
  const [f, setF] = useState({ kind: "event", label: "", amount: "", happened_on: todayStr() });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    const cents = Math.round(parseFloat(f.amount || "0") * 100);
    if (!cents) { flash("Enter an amount"); return; }
    const { error } = await client.from("ledger").insert({
      community_id: community.id, kind: f.kind, label: f.label.trim() || null,
      amount_cents: cents, happened_on: f.happened_on, created_by: session.user.id,
    });
    if (error) flash(error.message); else { flash("Logged 💚"); onSaved(); }
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
