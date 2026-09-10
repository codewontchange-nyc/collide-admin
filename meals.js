import { useState, useEffect, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Avatar, moneyExact } from "./ui.js?v=__V__";

/* Meals ("Homeplate") — this community's cooks, the meals they've posted, and
   the claims against them. Staff can close an open meal; everything else is
   read-only here (cooks manage their own listings in the app). */

const STATUS = { open: "member", closed: "", cancelled: "danger" };

export function MealsPage({ client, community, flash }) {
  const [meals, setMeals] = useState(null);
  const [cooks, setCooks] = useState([]);
  const [claims, setClaims] = useState([]);
  const [profiles, setProfiles] = useState({});

  const load = useCallback(async () => {
    const [m, c] = await Promise.all([
      // explicit columns: the exact pickup address/coords are column-gated to the cook + claimants,
      // so `*` would be denied outright — the neighbourhood-level `pickup_area` is what staff get
      client.from("meals").select("id,community_id,cook_id,title,photos,ingredients,allergens,cuisines,price_cents,portions,pay_method,pay_handle,pickup_area,pickup_start,pickup_end,status,city,created_at")
        .eq("community_id", community.id).order("pickup_start", { ascending: false }).limit(300),
      client.from("meal_cooks").select("*").eq("community_id", community.id),
    ]);
    const err = [m, c].find((r) => r.error);
    if (err) { flash("Meals: " + err.error.message); setMeals([]); return; }
    const mealIds = (m.data || []).map((x) => x.id);
    const { data: cl } = mealIds.length ? await client.from("meal_claims").select("*").in("meal_id", mealIds) : { data: [] };
    const ids = [...new Set([...(m.data || []).map((x) => x.cook_id), ...(c.data || []).map((x) => x.profile_id), ...(cl || []).map((x) => x.profile_id)].filter(Boolean))];
    const { data: pr } = ids.length ? await client.from("profiles").select("id,display_name,avatar_url").in("id", ids) : { data: [] };
    setProfiles(Object.fromEntries((pr || []).map((p) => [p.id, p])));
    setCooks(c.data || []); setClaims(cl || []); setMeals(m.data || []);
  }, [client, community.id]);
  useEffect(() => { load(); }, [load]);

  const close = async (meal) => {
    if (!confirm(`Close “${meal.title}”? Members won't be able to claim it anymore.`)) return;
    const { error } = await client.from("meals").update({ status: "closed" }).eq("id", meal.id);
    if (error) flash(error.message); else { flash("Closed"); load(); }
  };

  const claimsFor = (id) => claims.filter((c) => c.meal_id === id);
  const win = (m) => { try {
    const s = new Date(m.pickup_start), e = new Date(m.pickup_end);
    const t = (d) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return `${s.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${t(s)}–${t(e)}`;
  } catch { return "—"; } };
  const open = (meals || []).filter((m) => m.status === "open").length;
  const pending = claims.filter((c) => c.status === "pending").length;

  return html`<div class="page">
    <div class="pagehead"><h2 style="margin:0">Meals</h2></div>
    <div class="stats" style="grid-template-columns:repeat(4,1fr);max-width:900px">
      <div class="stat"><div class="lab">Open meals</div><div class="num">${meals === null ? "…" : open}</div></div>
      <div class="stat"><div class="lab">Cooks</div><div class="num">${meals === null ? "…" : cooks.filter((c) => c.active !== false).length}</div></div>
      <div class="stat"><div class="lab">Claims</div><div class="num">${meals === null ? "…" : claims.length}</div></div>
      <div class="stat"><div class="lab">Awaiting cook</div><div class="num" style=${pending ? "color:#6d682f" : ""}>${meals === null ? "…" : pending}</div></div>
    </div>

    <div class="section-label" style="margin-top:26px">Cooks</div>
    ${cooks.length === 0 ? html`<p class="tiny muted">No cooks have signed up in this community yet.</p>`
      : html`<table class="table"><thead><tr><th>Cook</th><th>Pays via</th><th>Pickup</th><th>Status</th></tr></thead><tbody>
        ${cooks.map((c) => { const p = profiles[c.profile_id]; return html`<tr>
          <td><span style="display:inline-flex;align-items:center;gap:8px">${p && html`<${Avatar} profile=${p} size="sm" />`}<b>${p?.display_name || "—"}</b></span></td>
          <td>${c.pay_method ? html`${c.pay_method} <span class="muted">${c.pay_handle || ""}</span>` : html`<span class="muted">—</span>`}</td>
          <td class="muted">${c.pickup_address || "—"}</td>
          <td><span class=${"pillstat " + (c.active === false ? "" : "member")}>${c.active === false ? "paused" : "active"}</span></td>
        </tr>`; })}
      </tbody></table>`}

    <div class="section-label" style="margin-top:30px">Meals</div>
    ${meals === null ? html`<div class="empty" style="border:0">Loading…</div>`
      : meals.length === 0 ? html`<div class="empty">No meals posted here yet.</div>`
      : html`<table class="table"><thead><tr><th>Meal</th><th>Cook</th><th>Pickup</th><th>Portions</th><th>Price</th><th>Claims</th><th>Status</th><th></th></tr></thead><tbody>
        ${meals.map((m) => { const p = profiles[m.cook_id]; const cl = claimsFor(m.id); const taken = cl.filter((c) => c.status === "approved").reduce((a, c) => a + (c.qty || 1), 0);
          return html`<tr>
            <td><b>${m.title}</b>${(m.allergens || []).length ? html`<div class="tiny muted">allergens: ${m.allergens.join(", ")}</div>` : ""}</td>
            <td>${p?.display_name || "—"}</td>
            <td class="muted">${win(m)}${m.pickup_area ? html`<div class="tiny">${m.pickup_area}</div>` : ""}</td>
            <td>${taken}/${m.portions ?? "—"}</td>
            <td>${m.price_cents ? moneyExact(m.price_cents) : "free"}${m.pay_method ? html` <span class="muted tiny">${m.pay_method}</span>` : ""}</td>
            <td>${cl.length ? html`${cl.length} <span class="muted tiny">(${cl.filter((c) => c.status === "pending").length} pending)</span>` : html`<span class="muted">—</span>`}</td>
            <td><span class=${"pillstat " + (STATUS[m.status] ?? "")}>${m.status || "—"}</span></td>
            <td class="rowactions">${m.status === "open" && html`<button class="btn small ghost" onClick=${() => close(m)}>Close</button>`}</td>
          </tr>`; })}
      </tbody></table>`}
    <p class="tiny muted" style="margin-top:10px">Cooks manage their own meals in the app; closing here just stops new claims.</p>
  </div>`;
}
