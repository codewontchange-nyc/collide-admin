import { useState, useEffect } from "https://esm.sh/preact@10.23.2/hooks";
import { html, money, moneyExact, niceDate, mediaUrl } from "./ui.js?v=10";

/* Partnerships, phase 1: the community's POI partners at a glance plus the
   partner income already logged in the ledger (kind = "poi"). Formal deals —
   contacts, terms, payouts — come later. */

export function PartnershipsPage({ client, community, go }) {
  const [pois, setPois] = useState([]);
  const [ledger, setLedger] = useState([]);

  useEffect(() => {
    if (!community) return;
    let live = true;
    (async () => {
      const [p, l] = await Promise.all([
        client.from("pois").select("*").eq("community_id", community.id).order("created_at", { ascending: false }),
        client.from("ledger").select("*").eq("community_id", community.id).eq("kind", "poi").order("happened_on", { ascending: false }).limit(200),
      ]);
      if (!live) return;
      setPois(p.data || []); setLedger(l.data || []);
    })();
    return () => { live = false; };
  }, [community?.id]);

  const total = ledger.reduce((a, r) => a + r.amount_cents, 0);
  const monthStart = (() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); })();
  const monthSum = ledger.filter((r) => r.happened_on >= monthStart).reduce((a, r) => a + r.amount_cents, 0);

  return html`<div class="page">
    <div class="pagehead">
      <h2 style="margin:0">Partnerships</h2>
      <span class="tiny muted">Formal deals (contacts, terms, payouts) are coming soon.</span>
    </div>

    <div class="stats" style="grid-template-columns:repeat(3,1fr);max-width:760px">
      <div class="stat"><div class="lab">Partner spots</div><div class="num">${pois.length}</div></div>
      <div class="stat"><div class="lab">Partner income this month</div><div class="num money">${money(monthSum)}</div></div>
      <div class="stat"><div class="lab">Partner income all-time</div><div class="num money">${money(total)}</div></div>
    </div>
    <p class="tiny muted">Partner spots are this community's points of interest on the shared map. Log partner income from the Money tab with kind 📍 POI.</p>

    <div class="section-label" style="margin-top:22px">Partner spots</div>
    <div class="poigrid" style="max-width:760px">
      ${pois.map((p) => html`<div class="poi" onClick=${() => go("map")} style="cursor:pointer">
        <div class="disc">${p.image_path ? html`<img src=${mediaUrl(client, p.image_path)} alt="" />` : "📍"}</div>
        <div class="n">${p.name}</div>
        ${p.category && html`<div class="c">${p.category}</div>`}
      </div>`)}
      ${pois.length === 0 && html`<div class="empty" style="grid-column:1/-1;cursor:pointer" onClick=${() => go("map")}>No partner spots yet — drop points of interest on the map ⚫</div>`}
    </div>

    ${ledger.length > 0 && html`<div style="margin-top:26px">
      <div class="section-label">Partner income</div>
      <table class="table">
        <thead><tr><th>Date</th><th>Label</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>
          ${ledger.map((r) => html`<tr>
            <td class="muted">${niceDate(r.happened_on)}</td>
            <td>${r.label || "—"}</td>
            <td style="text-align:right;font-weight:600;color:var(--green)">${moneyExact(r.amount_cents)}</td>
          </tr>`)}
        </tbody>
      </table>
    </div>`}
  </div>`;
}
