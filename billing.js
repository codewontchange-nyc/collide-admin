import { useState, useEffect, useCallback, useMemo } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Avatar, money } from "./ui.js?v=__V__";

/* Billing — Collide's own Stripe account. Two platform plans: Maker $5/mo
   (per profile) and Facilitator $25/mo (per community, billed to its owner).
   Rows come from public.subscriptions, mirrored by the stripe-webhook function;
   this page never talks to Stripe directly. Owner-only. */

const PLAN_LABEL = { maker: "maker · $5", facilitator: "facilitator · $25" };
const STATUS_CLASS = (s) =>
  s === "active" ? "member" : s === "trialing" ? "pending" : (s === "past_due" || s === "unpaid") ? "danger" : "";
const LIVE = new Set(["active", "trialing", "past_due", "unpaid"]);

const when = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return iso; }
};

export function BillingPage({ client, flash }) {
  const [subs, setSubs] = useState(null);      // null = loading
  const [names, setNames] = useState({});
  const [comms, setComms] = useState({});
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await client.from("subscriptions").select("*").order("updated_at", { ascending: false }).limit(500);
    if (error) { setErr(error.message); setSubs([]); return; }
    setSubs(data || []);
    const pids = [...new Set((data || []).map((s) => s.profile_id))];
    const cids = [...new Set((data || []).map((s) => s.community_id).filter(Boolean))];
    const [p, c] = await Promise.all([
      pids.length ? client.from("profiles").select("id,display_name,avatar_url").in("id", pids) : { data: [] },
      cids.length ? client.from("communities").select("id,name").in("id", cids) : { data: [] },
    ]);
    setNames(Object.fromEntries((p.data || []).map((x) => [x.id, x])));
    setComms(Object.fromEntries((c.data || []).map((x) => [x.id, x.name])));
  }, [client]);
  useEffect(() => { load(); }, [load]);

  const kpi = useMemo(() => {
    const rows = subs || [];
    const live = rows.filter((s) => LIVE.has(s.status));
    return {
      mrr: live.reduce((a, s) => a + (s.unit_amount_cents || 0), 0),
      active: rows.filter((s) => s.status === "active").length,
      trialing: rows.filter((s) => s.status === "trialing").length,
      pastDue: rows.filter((s) => s.status === "past_due" || s.status === "unpaid").length,
      rooms: rows.filter((s) => s.plan === "facilitator" && LIVE.has(s.status)).length,
    };
  }, [subs]);

  if (subs === null) return html`<div class="empty" style="border:0">Opening the books…</div>`;

  if (err) return html`<div class="empty">
    <b>Billing isn't switched on yet.</b>
    <p class="muted" style="margin:8px 0 0">${/subscriptions/.test(err) ? "Run the q96 billing migration (zion-collide/supabase/migrations/q96_billing.sql) in the SQL editor, then set the Stripe secrets." : err}</p>
  </div>`;

  return html`<div>
    <div class="stats">
      <div class="stat"><div class="n money">${money(kpi.mrr)}</div><div class="l">MRR</div></div>
      <div class="stat"><div class="n">${kpi.active}</div><div class="l">active</div></div>
      <div class="stat"><div class="n">${kpi.trialing}</div><div class="l">trialing</div></div>
      <div class="stat"><div class=${"n" + (kpi.pastDue ? " danger" : "")}>${kpi.pastDue}</div><div class="l">past due</div></div>
      <div class="stat"><div class="n">${kpi.rooms}</div><div class="l">rooms on the plan</div></div>
    </div>

    <h3 style="margin:22px 0 8px">Subscriptions <span class="muted" style="font:400 12px var(--body)">· mirrored from Stripe by the webhook · ${subs.length} total</span></h3>
    ${subs.length === 0
      ? html`<div class="empty">No subscriptions yet. The first maker to keep their listing shows up here.</div>`
      : html`<table class="tbl">
          <thead><tr><th>Who</th><th>Plan</th><th>Status</th><th>Renews / ends</th><th>Since</th><th></th></tr></thead>
          <tbody>
            ${subs.map((s) => {
              const p = names[s.profile_id] || {};
              const label = s.plan === "facilitator" ? (comms[s.community_id] || "room") : (p.display_name || "—");
              const sub = s.plan === "facilitator" ? "owner · " + (p.display_name || "—") : "";
              return html`<tr key=${s.id}>
                <td><div style="display:flex;align-items:center;gap:8px"><${Avatar} profile=${p} size=${26} /><div><div>${label}</div>${sub && html`<div class="tiny muted">${sub}</div>`}</div></div></td>
                <td><span class=${"pillstat " + (s.plan === "facilitator" ? "facilitator" : "")}>${PLAN_LABEL[s.plan] || s.plan}</span>${!s.livemode && html`<span class="tiny muted"> · test</span>`}</td>
                <td><span class=${"pillstat " + STATUS_CLASS(s.status)}>${s.status}${s.cancel_at_period_end ? " · ends" : ""}</span></td>
                <td>${when(s.current_period_end)}</td>
                <td class="tiny muted">${when(s.created_at)}</td>
                <td><a class="linkbtn tiny" target="_blank" rel="noopener" href=${"https://dashboard.stripe.com/" + (s.livemode ? "" : "test/") + "subscriptions/" + s.stripe_subscription_id}>open in Stripe ›</a></td>
              </tr>`;
            })}
          </tbody>
        </table>`}
    <p class="tiny muted" style="margin-top:14px">Card updates and cancellations happen in Stripe's customer portal (members reach it from "Manage billing" in the app). Failed renewals keep a listing in the paper for 7 days while Stripe retries the card.</p>
  </div>`;
}
