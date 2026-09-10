import { useState, useEffect, useRef, useCallback } from "https://esm.sh/preact@10.23.2/hooks";

/* db.js — everything that touches the network, in one place.
   Config + environment constants, storage/function URLs, the edge-function
   caller, paging/count helpers, the error channel (toast + Issues telemetry),
   explicit column lists for column-granted tables, and the `useLoader` hook
   every page uses for "load a list, show it, survive errors". */

/* ---------- config / environment ---------- */
export const cfg = () => window.CA_CONFIG || {};
export const ENV = {
  PROJECT_REF: "pjxvvwcnjjizdtiutpxd",
  APP_URL: "https://codewontchange-nyc.github.io/Collide",
  SITE_URL: "https://codewontchange-nyc.github.io/collide-site",
  // must match VAPID_PUBLIC_KEY in the push-send / crm-tick functions
  VAPID_PUBLIC: "BI1Xp1ZvZNopnjJcUYUl7ZoK99SlCzIkq8yXGo3FT0tJALblL1EkseSrZKzixa-kIxYBviIQsA6QTV_-F_e5Ttg",
};
export const BUCKETS = { avatars: "avatars", media: "event-media", map: "map" };

export const fnUrl = (name, params) => {
  const base = `${cfg().SUPABASE_URL || ""}/functions/v1/${name}`;
  const q = params ? new URLSearchParams(params).toString() : "";
  return q ? `${base}?${q}` : base;
};
export const storageUrl = (bucket, path) =>
  !path ? null : path.startsWith("http") ? path : `${cfg().SUPABASE_URL || ""}/storage/v1/object/public/${bucket}/${path}`;

/* ---------- edge functions ---------- */
// One caller for every function: returns { data, error } where error is the
// server's own message when it sent one (FunctionsHttpError hides it in context).
export async function callFn(client, name, body) {
  const { data, error } = await client.functions.invoke(name, { body });
  if (!error) return { data, error: null };
  let msg = error.message;
  try { msg = (await error.context.json()).error || msg; } catch { /* keep the generic message */ }
  return { data: null, error: msg };
}
// Shape the existing call sites expect: `{ error }` on failure, else the payload.
const flat = async (p) => { const r = await p; return r.error ? { error: r.error } : (r.data || { ok: true }); };
export const sendModerate = (client, body) => flat(callFn(client, "moderate", body));
export const sendInvite = (client, body) => flat(callFn(client, "invite", body));
export const runEngine = (client, dry) => flat(callFn(client, "crm-tick", { dry }));

/* ---------- reads ---------- */
// Page through a table so lists/metrics aren't silently capped at PostgREST's
// default 1000-row ceiling. `page(from, to)` returns a range-bound query.
export async function paged(page) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await page(from, from + 999);
    if (error) return { data: rows, error };
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return { data: rows, error: null };
}
// Server-side count — the only honest way to get a total that may exceed a list cap.
export async function countOf(client, table, apply = (q) => q, col = "id") {
  const { count, error } = await apply(client.from(table).select(col, { count: "exact", head: true }));
  return { count: count || 0, error };
}
// `.in(col, ids)` with a long id list becomes a URL too long to send — chunk it.
export async function inChunks(ids, size, fetch) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) {
    const { data, error } = await fetch(ids.slice(i, i + size));
    if (error) return { data: out, error };
    out.push(...(data || []));
  }
  return { data: out, error: null };
}
export const firstError = (results) => results.find((r) => r && r.error)?.error || null;

/* ---------- errors ---------- */
// Toast it AND record it: caught errors used to vanish after a 2.2s flash,
// invisible to the Issues page. Returns the message.
export function showError(flash, where, error) {
  const msg = typeof error === "string" ? error : (error?.message || String(error || "unknown error"));
  if (flash) flash((where ? where + ": " : "") + msg);
  try { window.CA?.report?.(msg, error?.stack, "console:" + (where || "page")); } catch { /* telemetry never throws */ }
  return msg;
}

/* ---------- column lists ----------
   Some tables have column-level grants (meals hides the exact pickup address
   from `authenticated`); `select("*")` on those is denied outright. Member-data
   tables get an explicit list so a future grant can't blank a page. */
export const COLS = {
  profileMin: "id,display_name,avatar_url",
  profile: "id,display_name,avatar_url,created_at,home_city,socials,phone,crm_opt_out",
  staff: "id,email,role,community_id,profile_id,created_at",
  meals: "id,community_id,cook_id,title,photos,ingredients,allergens,cuisines,price_cents,portions,pay_method,pay_handle,pickup_area,pickup_start,pickup_end,status,city,created_at",
};

/* ---------- the page loader ----------
   const { data, error, loading, reload, setData } = useLoader(
     () => client.from("ledger").select("*").eq("community_id", id),   // returns {data,error} (a query builder is fine)
     [client, id],
     { flash, where: "Money", client, realtime: [{ table: "ledger", filter: `community_id=eq.${id}` }] });
   - `data` is null until the first load resolves (the console's "loading" convention)
   - on error: data → [] and `error` holds the message; showError() has already toasted + reported it
   - stale responses are dropped (sequence counter), so a fast tab switch never paints old rows
   - `keep: true` leaves the previous rows on screen during a reload (inline-edit grids) */
export function useLoader(load, deps, opts = {}) {
  const { flash, where, client, realtime, keep } = opts;
  const [state, set] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const run = useCallback(async () => {
    const my = ++seq.current;
    set((s) => ({ ...s, error: null, loading: true }));   // a reload keeps the old rows on screen
    let res;
    try { res = await load(); } catch (e) { res = { error: e }; }
    if (my !== seq.current) return;
    if (res && res.error) { set({ data: [], error: showError(flash, where, res.error), loading: false }); return; }
    set({ data: res && "data" in res ? (res.data || []) : (res || []), error: null, loading: false });
  }, deps);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!keep) set({ data: null, error: null, loading: true }); run(); }, [run]);   // deps changed → fresh "loading"

  const rt = JSON.stringify(realtime || null);
  useEffect(() => {
    if (!realtime || !realtime.length || !client) return;
    let t;
    const ch = client.channel("ca:" + (where || "page") + ":" + Math.random().toString(36).slice(2, 6));
    realtime.forEach(({ table, filter, schema = "public", event = "*" }) =>
      ch.on("postgres_changes", { event, schema, table, ...(filter ? { filter } : {}) }, () => { clearTimeout(t); t = setTimeout(run, 250); }));
    ch.subscribe();
    return () => { clearTimeout(t); try { client.removeChannel(ch); } catch { /* already gone */ } };
  }, [run, client, rt]);   // eslint-disable-line react-hooks/exhaustive-deps

  const setData = useCallback((v) => set((s) => ({ ...s, data: typeof v === "function" ? v(s.data) : v })), []);
  return { data: state.data, error: state.error, loading: state.loading, reload: run, setData };
}
