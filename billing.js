import { useMemo } from "https://esm.sh/preact@10.23.2/hooks";
import { html, Page, Metrics, Pill, Avatar, Loading, Empty, money, fullDate } from "./ui.js?v=__V__";
import { useLoader, COLS } from "./db.js?v=__V__";

/* Billing — Collide's own Stripe account. Two platform plans: Maker $5/mo
   (per profile) and Facilitator $25/mo (per community, billed to its owner).
   Rows come from public.subscriptions, mirrored by the stripe-webhook function;
   this page never talks to Stripe directly. Owner-only. */

const PLAN_LABEL = { maker: "maker · $5", facilitator: "facilitator · $25" };
const LIVE = new Set(["active", "trialing", "past_due", "unpaid"]);

export function BillingPage({ client, flash }) {
  const { data, error } = useLoader(async () => {
    const { data: subs, error: e } = await client.from("subscriptions").select("*").order("updated_at", { ascending: false }).limit(500);
    if (e) return { error: e };
    const pids = [...new Set((subs || []).map((s) => s.profile_id))];
    const cids = [...new Set((subs || []).map((s) => s.community_id).filter(Boolean))];
    const [p, c] = await Promise.all([
      pids.length ? client.from("profiles").select(COLS.profileMin).in("id", pids) : { data: [] },
      cids.length ? client.from("communities").select("id,name").in("id", cids) : { data: [] },
    ]);
    return { data: { subs: subs || [], names: Object.fromEntries((p.data || []).map((x) => [x.id, x])), comms: Object.fromEntries((c.data || []).map((x) => [x.id, x.name])) } };
  }, [client], { flash: null, where: "Billing" });   // a missing table is the expected "not switched on" state, not a toast
  const loading = data === null;
  const d = data && !Array.isArray(data) ? data : { subs: [], names: {}, comms: {} };

  const kpi = useMemo(() => {
    const live = d.subs.filter((s) => LIVE.has(s.status));
    return {
      mrr: live.reduce((a, s) => a + (s.unit_amount_cents || 0), 0),
      active: d.subs.filter((s) => s.status === "active").length,
      trialing: d.subs.filter((s) => s.status === "trialing").length,
      pastDue: d.subs.filter((s) => s.status === "past_due" || s.status === "unpaid").length,
      rooms: d.subs.filter((s) => s.plan === "facilitator" && LIVE.has(s.status)).length,
    };
  }, [d.subs]);

  return html`<${Page} title="Billing" sub="Collide's Stripe plans — mirrored from the webhook">
    ${loading ? html`<${Loading} label="Opening the books…" />`
      : error ? html`<${Empty}>
          <b>Billing isn't switched on yet.</b>
          <p class="muted" style="margin:8px 0 0">${/subscriptions/.test(error) ? "Run the q96 billing migration (zion-collide/supabase/migrations/q96_billing.sql) in the SQL editor, then set the Stripe secrets." : error}</p>
        </${Empty}>`
      : html`
    <${Metrics} items=${[
      ["MRR", money(kpi.mrr), { money: true }],
      ["active", kpi.active],
      ["trialing", kpi.trialing],
      ["past due", kpi.pastDue, { tone: kpi.pastDue ? "bad" : "" }],
      ["rooms on the plan", kpi.rooms],
    ]} />
    <div class="section-label u-mt-2">Subscriptions <span class="sub">· ${d.subs.length} total</span></div>
    ${d.subs.length === 0
      ? html`<${Empty}>No subscriptions yet. The first maker to keep their listing shows up here.</${Empty}>`
      : html`<table class="table">
          <thead><tr><th>Who</th><th>Plan</th><th>Status</th><th>Renews / ends</th><th>Since</th><th></th></tr></thead>
          <tbody>
            ${d.subs.map((s) => {
              const p = d.names[s.profile_id] || {};
              const label = s.plan === "facilitator" ? (d.comms[s.community_id] || "room") : (p.display_name || "—");
              const sub = s.plan === "facilitator" ? "owner · " + (p.display_name || "—") : "";
              return html`<tr key=${s.id}>
                <td><span class="who"><${Avatar} profile=${p} size=${26} /><span><div>${label}</div>${sub && html`<div class="tiny muted">${sub}</div>`}</span></span></td>
                <td><${Pill} tone=${s.plan === "facilitator" ? "brand" : "neutral"}>${PLAN_LABEL[s.plan] || s.plan}</${Pill}>${!s.livemode && html`<span class="tiny muted"> · test</span>`}</td>
                <td><${Pill}>${s.status}${s.cancel_at_period_end ? " · ends" : ""}</${Pill}></td>
                <td>${fullDate(s.current_period_end)}</td>
                <td class="tiny muted">${fullDate(s.created_at)}</td>
                <td><a class="btn link tiny" target="_blank" rel="noopener" href=${"https://dashboard.stripe.com/" + (s.livemode ? "" : "test/") + "subscriptions/" + s.stripe_subscription_id}>open in Stripe ›</a></td>
              </tr>`;
            })}
          </tbody>
        </table>`}
    <p class="tiny muted u-mt-1">Card updates and cancellations happen in Stripe's customer portal (members reach it from "Manage billing" in the app). Failed renewals keep a listing in the paper for 7 days while Stripe retries the card.</p>`}
  </${Page}>`;
}
