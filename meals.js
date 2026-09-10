import { html, Page, Metrics, Pill, Avatar, Loading, Empty, LoadError, moneyExact, timeRange, confirmDanger } from "./ui.js?v=__V__";
import { useLoader, COLS, firstError, showError } from "./db.js?v=__V__";

/* Meals ("Homeplate") — this community's cooks, the meals they've posted, and
   the claims against them. Staff can close an open meal; everything else is
   read-only here (cooks manage their own listings in the app).
   The exact pickup address / coordinates are column-gated to the cook and
   claimants, so `COLS.meals` deliberately stops at the neighbourhood. */

const COOK_COLS = "community_id,profile_id,pay_method,pay_handle,pickup_address,active,created_at";
const CLAIM_COLS = "meal_id,profile_id,qty,status,created_at,decided_at";

export function MealsPage({ client, community, flash }) {
  const { data, error, reload } = useLoader(async () => {
    const [m, c] = await Promise.all([
      client.from("meals").select(COLS.meals).eq("community_id", community.id).order("pickup_start", { ascending: false }).limit(300),
      client.from("meal_cooks").select(COOK_COLS).eq("community_id", community.id),
    ]);
    const err = firstError([m, c]); if (err) return { error: err };
    const mealIds = (m.data || []).map((x) => x.id);
    const cl = mealIds.length ? await client.from("meal_claims").select(CLAIM_COLS).in("meal_id", mealIds) : { data: [] };
    if (cl.error) return { error: cl.error };
    const ids = [...new Set([...(m.data || []).map((x) => x.cook_id), ...(c.data || []).map((x) => x.profile_id), ...(cl.data || []).map((x) => x.profile_id)].filter(Boolean))];
    const pr = ids.length ? await client.from("profiles").select(COLS.profileMin).in("id", ids) : { data: [] };
    return { data: { meals: m.data || [], cooks: c.data || [], claims: cl.data || [], profiles: Object.fromEntries((pr.data || []).map((p) => [p.id, p])) } };
  }, [client, community.id], { flash, where: "Meals" });

  const loading = data === null;
  const d = data && !Array.isArray(data) ? data : { meals: [], cooks: [], claims: [], profiles: {} };
  const claimsFor = (id) => d.claims.filter((c) => c.meal_id === id);
  const open = d.meals.filter((m) => m.status === "open").length;
  const pending = d.claims.filter((c) => c.status === "pending").length;

  const close = async (meal) => {
    if (!confirmDanger(`Close “${meal.title}”? Members won't be able to claim it anymore.`)) return;
    const { error: e } = await client.from("meals").update({ status: "closed" }).eq("id", meal.id);
    if (e) showError(flash, "Close meal", e); else { flash("Closed"); reload(); }
  };

  return html`<${Page} title="Meals">
    <${Metrics} loading=${loading} items=${[
      ["Open meals", open],
      ["Cooks", d.cooks.filter((c) => c.active !== false).length],
      ["Claims", d.claims.length],
      ["Awaiting cook", pending, { tone: pending ? "warn" : "" }],
    ]} />
    ${error && html`<${LoadError} what="meals" error=${error} onRetry=${reload} />`}

    <div class="section-label u-mt-2">Cooks</div>
    ${loading ? html`<${Loading} />` : d.cooks.length === 0 ? html`<p class="tiny muted">No cooks have signed up in this community yet.</p>`
      : html`<table class="table"><thead><tr><th>Cook</th><th>Pays via</th><th>Pickup</th><th>Status</th></tr></thead><tbody>
        ${d.cooks.map((c) => { const p = d.profiles[c.profile_id]; return html`<tr>
          <td><span class="who">${p && html`<${Avatar} profile=${p} size="sm" />`}<b>${p?.display_name || "—"}</b></span></td>
          <td>${c.pay_method ? html`${c.pay_method} <span class="muted">${c.pay_handle || ""}</span>` : html`<span class="muted">—</span>`}</td>
          <td class="muted">${c.pickup_address || "—"}</td>
          <td><${Pill}>${c.active === false ? "paused" : "active"}</${Pill}></td>
        </tr>`; })}
      </tbody></table>`}

    <div class="section-label u-mt-3">Meals</div>
    ${loading ? html`<${Loading} />`
      : d.meals.length === 0 ? html`<${Empty}>No meals posted here yet.</${Empty}>`
      : html`<table class="table"><thead><tr><th>Meal</th><th>Cook</th><th>Pickup</th><th>Portions</th><th>Price</th><th>Claims</th><th>Status</th><th></th></tr></thead><tbody>
        ${d.meals.map((m) => { const p = d.profiles[m.cook_id]; const cl = claimsFor(m.id); const taken = cl.filter((c) => c.status === "approved").reduce((a, c) => a + (c.qty || 1), 0);
          return html`<tr>
            <td><b>${m.title}</b>${(m.allergens || []).length ? html`<div class="tiny muted">allergens: ${m.allergens.join(", ")}</div>` : ""}</td>
            <td>${p?.display_name || "—"}</td>
            <td class="muted">${timeRange(m.pickup_start, m.pickup_end)}${m.pickup_area ? html`<div class="tiny">${m.pickup_area}</div>` : ""}</td>
            <td class="u-num">${taken}/${m.portions ?? "—"}</td>
            <td>${m.price_cents ? moneyExact(m.price_cents) : "free"}${m.pay_method ? html` <span class="muted tiny">${m.pay_method}</span>` : ""}</td>
            <td>${cl.length ? html`${cl.length} <span class="muted tiny">(${cl.filter((c) => c.status === "pending").length} pending)</span>` : html`<span class="muted">—</span>`}</td>
            <td><${Pill}>${m.status || "—"}</${Pill}></td>
            <td class="actions">${m.status === "open" && html`<button class="btn sm ghost" onClick=${() => close(m)}>Close</button>`}</td>
          </tr>`; })}
      </tbody></table>`}
    <p class="tiny muted u-mt-1">Cooks manage their own meals in the app; closing here just stops new claims.</p>
  </${Page}>`;
}
