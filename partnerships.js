import { html, Page, Metrics, Empty, LoadError, money, moneyExact, niceDate, mediaUrl, monthStartStr } from "./ui.js?v=__V__";
import { useLoader, firstError } from "./db.js?v=__V__";

/* Partnerships, phase 1: the community's POI partners at a glance plus the
   partner income already logged in the ledger (kind = "poi"). Formal deals —
   contacts, terms, payouts — come later. */

export function PartnershipsPage({ client, community, go, flash }) {
  const { data, error, reload } = useLoader(async () => {
    const [p, l] = await Promise.all([
      client.from("pois").select("id,name,category,image_path,created_at").eq("community_id", community.id).order("created_at", { ascending: false }),
      client.from("ledger").select("id,label,amount_cents,happened_on").eq("community_id", community.id).eq("kind", "poi").order("happened_on", { ascending: false }).limit(200),
    ]);
    const err = firstError([p, l]); if (err) return { error: err };
    return { data: { pois: p.data || [], ledger: l.data || [] } };
  }, [client, community.id], { flash, where: "Partnerships" });

  const loading = data === null;
  const d = data && !Array.isArray(data) ? data : { pois: [], ledger: [] };
  const total = d.ledger.reduce((a, r) => a + r.amount_cents, 0);
  const monthStart = monthStartStr();
  const monthSum = d.ledger.filter((r) => r.happened_on >= monthStart).reduce((a, r) => a + r.amount_cents, 0);

  return html`<${Page} title="Partnerships" actions=${html`<span class="tiny muted">Formal deals (contacts, terms, payouts) are coming soon.</span>`}>
    <${Metrics} loading=${loading} items=${[
      ["Partner spots", d.pois.length],
      ["Partner income this month", money(monthSum), { money: true }],
      ["Partner income all-time", money(total), { money: true }],
    ]} />
    <p class="tiny muted">Partner spots are this community's points of interest on the shared map. Log partner income from the Money tab with kind 📍 POI.</p>

    <div class="section-label u-mt-2">Partner spots</div>
    ${error ? html`<${LoadError} what="partner spots" error=${error} onRetry=${reload} />` : html`<div class="poigrid" style="max-width:760px">
      ${d.pois.map((p) => html`<div class="poi" onClick=${() => go("map")} style="cursor:pointer">
        <div class="disc">${p.image_path ? html`<img src=${mediaUrl(client, p.image_path)} alt="" />` : "📍"}</div>
        <div class="n">${p.name}</div>
        ${p.category && html`<div class="c">${p.category}</div>`}
      </div>`)}
      ${loading && html`<${Empty} span bare>Loading…</${Empty}>`}
      ${!loading && d.pois.length === 0 && html`<${Empty} span onClick=${() => go("map")}>No partner spots yet — drop points of interest on the map ⚫</${Empty}>`}
    </div>`}

    ${d.ledger.length > 0 && html`<div class="u-mt-3">
      <div class="section-label">Partner income</div>
      <table class="table">
        <thead><tr><th>Date</th><th>Label</th><th class="u-right">Amount</th></tr></thead>
        <tbody>${d.ledger.map((r) => html`<tr>
          <td class="muted">${niceDate(r.happened_on)}</td>
          <td>${r.label || "—"}</td>
          <td class="amt">${moneyExact(r.amount_cents)}</td>
        </tr>`)}</tbody>
      </table>
    </div>`}
  </${Page}>`;
}
