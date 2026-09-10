// _shared/http.ts — the one CORS/JSON/auth scaffold every console function uses.
//
//   import { CORS, json, text, preflight, caller } from "../_shared/http.ts";
//
// · CORS: one header set (the app adds x-collide-city; harmless to allow here)
// · json(body, status) / text(body, status, type): responses always carry CORS
// · preflight(req): the OPTIONS answer, or null
// · caller(req): { user, jwt, client } — `client` is scoped to the caller's JWT,
//   so RLS + the SQL helpers (is_owner / is_any_staff) answer for THEM, and
//   the four hand-rolled copies of "is this email an owner" collapse to one
//   rpc("is_owner").

import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-collide-city",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
export const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", ...extra } });
export const text = (body: string, status = 200, type = "text/plain; charset=utf-8", extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { ...CORS, "Content-Type": type, ...extra } });
export const preflight = (req: Request) => (req.method === "OPTIONS" ? new Response("ok", { headers: CORS }) : null);

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

export type Caller = { user: User; jwt: string; client: SupabaseClient };
// null when the request carries no usable session
export async function caller(req: Request): Promise<Caller | null> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const client = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const { data: { user } } = await client.auth.getUser(jwt);
  return user ? { user, jwt, client } : null;
}
export const isOwner = async (c: Caller) => (await c.client.rpc("is_owner")).data === true;
export const isAnyStaff = async (c: Caller) => (await c.client.rpc("is_any_staff")).data === true;
// generic failure — the real message goes to the function log, not the wire
export const fail = (e: unknown) => { console.error(e); return json({ error: "internal" }, 500); };
