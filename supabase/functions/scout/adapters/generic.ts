// adapters/generic.ts — any public event page. Cheapest signal first:
//   schema.org JSON-LD Event(s) → Open Graph / <time> → Claude (only when no
//   date was found, or the admin asks). Never runs a browser.

import { type Item, type CityRow, canonicalUrl, parseWhen, toCents, trim } from "../lib/item.ts";
import { visibleText } from "../lib/fetch.ts";

const EVENT_TYPES = new Set(["Event", "MusicEvent", "SocialEvent", "Festival", "TheaterEvent", "ComedyEvent", "DanceEvent", "FoodEvent", "SportsEvent", "ExhibitionEvent", "ScreeningEvent", "EducationEvent", "BusinessEvent", "LiteraryEvent", "VisualArtsEvent", "ChildrensEvent", "Hackathon", "SaleEvent"]);

// deno-lint-ignore no-explicit-any
type J = any;
const str = (v: J): string | null => (typeof v === "string" ? v : Array.isArray(v) ? str(v[0]) : v && typeof v === "object" ? str(v.name ?? v.url ?? v["@id"]) : null);
const imgOf = (v: J): string | null => (typeof v === "string" ? v : Array.isArray(v) ? imgOf(v[0]) : v && typeof v === "object" ? str(v.url ?? v.contentUrl) : null);

export function jsonLdBlocks(html: string): J[] {
  const out: J[] = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[1].trim().replace(/^<!--|-->$/g, "");
    try { out.push(JSON.parse(raw)); } catch { try { out.push(JSON.parse(raw.replace(/[\u0000-\u001f]+/g, " "))); } catch { /* skip */ } }
  }
  return out;
}
// walk arrays / @graph / mainEntity / itemListElement.item, yield every Event-typed node
export function jsonLdEvents(blocks: J[]): J[] {
  const found: J[] = [];
  const seen = new Set<J>();
  const walk = (n: J, depth = 0) => {
    if (!n || typeof n !== "object" || depth > 6 || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach((x) => walk(x, depth + 1)); return; }
    const t = n["@type"]; const types = Array.isArray(t) ? t : t ? [t] : [];
    if (types.some((x: string) => EVENT_TYPES.has(x))) found.push(n);
    for (const k of ["@graph", "mainEntity", "itemListElement", "item", "subEvent", "hasPart"]) if (n[k]) walk(n[k], depth + 1);
  };
  blocks.forEach((b) => walk(b));
  return found;
}

function addressOf(loc: J): { venue: string | null; address: string | null; lat: number | null; lng: number | null } {
  if (!loc) return { venue: null, address: null, lat: null, lng: null };
  if (Array.isArray(loc)) return addressOf(loc.find((l) => l && l["@type"] !== "VirtualLocation") ?? loc[0]);
  if (typeof loc === "string") return { venue: loc, address: loc, lat: null, lng: null };
  const a = loc.address;
  const address = typeof a === "string" ? a : a ? [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].filter(Boolean).join(", ") : null;
  const geo = loc.geo || {};
  return { venue: str(loc.name) || (address ? address.split(",")[0] : null), address: address || null,
    lat: typeof geo.latitude === "number" ? geo.latitude : Number(geo.latitude) || null, lng: typeof geo.longitude === "number" ? geo.longitude : Number(geo.longitude) || null };
}
function priceOf(offers: J): { min: number | null; max: number | null; cur: string } {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  const vals: number[] = []; let cur = "USD";
  for (const o of list) {
    if (!o || typeof o !== "object") continue;
    for (const k of ["price", "lowPrice", "highPrice"]) { const c = toCents(o[k]); if (c != null) vals.push(c); }
    if (o.priceCurrency) cur = String(o.priceCurrency);
  }
  return vals.length ? { min: Math.min(...vals), max: Math.max(...vals), cur } : { min: null, max: null, cur };
}

export function itemsFromJsonLd(html: string, pageUrl: string, city: CityRow): Item[] {
  const events = jsonLdEvents(jsonLdBlocks(html));
  const out: Item[] = [];
  for (const e of events) {
    const st = parseWhen(e.startDate, city.tz); const title = trim(str(e.name), 140);
    if (!st || !title) continue;
    const en = parseWhen(e.endDate, city.tz);
    const loc = addressOf(e.location); const price = priceOf(e.offers);
    const url = canonicalUrl(str(e.url) || (e.offers && str(Array.isArray(e.offers) ? e.offers[0]?.url : e.offers.url)) || pageUrl);
    out.push({
      source: "generic", external_id: url, url,
      title, description: trim(str(e.description), 1000) || null,
      start_date: st.date, start_time: st.time, starts_at: st.iso, ends_at: en?.iso || null,
      venue_name: loc.venue, address: loc.address, lat: loc.lat, lng: loc.lng,
      image_url: imgOf(e.image), price_min_cents: price.min, price_max_cents: price.max, currency: price.cur,
      organizer_name: str(e.organizer?.name ?? e.organizer) || str(e.performer?.name ?? e.performer) || null,
      organizer_url: str(e.organizer?.url) || null,
      categories: [str(e.eventAttendanceMode) ? "" : "", ...(Array.isArray(e.keywords) ? e.keywords : String(e.keywords || "").split(",")), ...(Array.isArray(e["@type"]) ? e["@type"] : [e["@type"]])].map((s) => String(s || "").trim()).filter(Boolean),
      raw: e,
    });
  }
  // de-dupe within the page
  const seen = new Set<string>();
  return out.filter((i) => { const k = i.source + "|" + i.external_id; if (seen.has(k)) return false; seen.add(k); return true; });
}

/* ---------- Open Graph / <time> fallback ---------- */
const meta = (html: string, key: string) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key.replace(/[:.]/g, "\\$&")}["'][^>]*content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key.replace(/[:.]/g, "\\$&")}["']`, "i");
  const m = html.match(re); return m ? (m[1] || m[2] || "").trim() : null;
};
export function ogFallback(html: string, pageUrl: string, city: CityRow): Partial<Item> {
  const title = meta(html, "og:title") || (html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1] || "").trim();
  const description = meta(html, "og:description") || meta(html, "description");
  const image = meta(html, "og:image:secure_url") || meta(html, "og:image") || meta(html, "twitter:image");
  const t = meta(html, "event:start_time") || html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1] || null;
  const st = parseWhen(t, city.tz);
  return { title: trim(title, 140) || undefined, description: trim(description, 1000) || null,
    image_url: image ? (() => { try { return new URL(image, pageUrl).toString(); } catch { return null; } })() : null,
    ...(st ? { start_date: st.date, start_time: st.time, starts_at: st.iso } : {}) };
}

/* ---------- Claude, forced-tool, only when the cheap paths found no date ---------- */
const TOOL = {
  name: "emit_event",
  description: "Report the single event described by this web page. Use the city's local clock. If the page is not about one specific upcoming event, set not_event true.",
  input_schema: {
    type: "object",
    properties: {
      not_event: { type: "boolean" },
      title: { type: "string" }, description: { type: "string" },
      start_date: { type: "string", description: "YYYY-MM-DD local" }, start_time: { type: ["string", "null"], description: "HH:MM 24h local, null if not stated" },
      end_time: { type: ["string", "null"] },
      venue_name: { type: ["string", "null"] }, address: { type: ["string", "null"] },
      price_min_dollars: { type: ["number", "null"] }, price_max_dollars: { type: ["number", "null"] },
      organizer_name: { type: ["string", "null"] }, categories: { type: "array", items: { type: "string" } },
    },
    required: ["not_event", "title", "start_date"],
  },
};
export async function claudeExtract(html: string, pageUrl: string, city: CityRow, today: string): Promise<Partial<Item> & { not_event?: boolean } | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY"); if (!key) return null;
  const text = visibleText(html);
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(20000),
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-5", max_tokens: 600,
      system: `You extract event listings for a city guide. Today is ${today} in ${city.name} (timezone ${city.tz}). Dates without a year mean the next occurrence on or after today. Only report facts stated on the page.`,
      tools: [TOOL], tool_choice: { type: "tool", name: "emit_event" },
      messages: [{ role: "user", content: `Page: ${pageUrl}\n\n${text}` }],
    }),
  });
  const j = await resp.json();
  const tu = (j.content || []).find((c: J) => c.type === "tool_use");
  if (!tu?.input) return null;
  const i = tu.input;
  if (i.not_event) return { not_event: true };
  const st = parseWhen(i.start_date && i.start_time ? `${i.start_date}T${i.start_time}` : i.start_date, city.tz);
  if (!st) return null;
  return {
    title: trim(i.title, 140), description: trim(i.description, 1000) || null,
    start_date: st.date, start_time: st.time, starts_at: st.iso,
    venue_name: i.venue_name || null, address: i.address || null,
    price_min_cents: i.price_min_dollars != null ? Math.round(i.price_min_dollars * 100) : null,
    price_max_cents: i.price_max_dollars != null ? Math.round(i.price_max_dollars * 100) : null,
    organizer_name: i.organizer_name || null, categories: Array.isArray(i.categories) ? i.categories : [],
  };
}
