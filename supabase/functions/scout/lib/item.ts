// lib/item.ts — the one shape every source normalizes to, plus the small
// pure helpers around it (canonical URLs, fingerprints, city-local time,
// the same when_bucket/expiry rules the console's ui.js applies).

export type Item = {
  source: "generic" | "ics" | "rss" | "jsonld_page";
  external_id: string;
  url: string;
  title: string;
  description?: string | null;
  start_date: string;                 // YYYY-MM-DD, local to the city
  start_time?: string | null;         // HH:MM local; null = time TBD
  starts_at?: string | null;          // ISO instant when known
  ends_at?: string | null;
  venue_name?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  image_url?: string | null;
  price_min_cents?: number | null;
  price_max_cents?: number | null;
  currency?: string;
  organizer_name?: string | null;
  organizer_url?: string | null;
  categories: string[];
  raw?: unknown;
};

export type CityRow = { code: string; name: string; lat: number | null; lng: number | null; radius_km: number; tz: string };

const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$|_hs)/i;
export function canonicalUrl(u: string): string {
  try {
    const x = new URL(u.trim());
    x.hostname = x.hostname.toLowerCase().replace(/^www\./, "");
    x.hash = "";
    for (const k of [...x.searchParams.keys()]) if (TRACKING.test(k)) x.searchParams.delete(k);
    let s = x.toString();
    if (s.endsWith("/") && x.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch { return u.trim(); }
}

const STOP = new Set(["the", "a", "an", "at", "in", "on", "of", "and", "with", "live", "presents", "w", "featuring", "feat", "night", "nyc", "atlanta", "atl", "new", "york"]);
export const norm = (s: string) => (s || "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
export const fingerprint = (title: string, date: string, venue?: string | null) =>
  `${norm(title).slice(0, 6).join(" ")}|${date}|${norm(venue || "")[0] || ""}`;

/* ---------- city-local time ---------- */
export function localParts(d: Date, tz: string): { date: string; time: string } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}
export const todayIn = (tz: string) => localParts(new Date(), tz).date;
// wall time in a zone → instant (DST-aware; same trick the ics function uses)
export function zonedToUtc(dateStr: string, timeStr: string, tz: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = (timeStr || "00:00").split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const p = localParts(new Date(guess), tz);
  const [py, pm, pd] = p.date.split("-").map(Number); const [ph, pmin] = p.time.split(":").map(Number);
  const asIf = Date.UTC(py, pm - 1, pd, ph, pmin);
  return new Date(guess + (guess - asIf));
}
// "2026-09-12" | "2026-09-12T19:00" | "…T19:00:00-04:00" | "…Z" → local parts for the city
export function parseWhen(v: string | null | undefined, tz: string): { date: string; time: string | null; iso: string | null } | null {
  if (!v) return null;
  const m = String(v).trim().match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i);
  if (m) {
    if (!m[2]) return { date: m[1], time: null, iso: null };
    if (!m[3]) { return { date: m[1], time: m[2], iso: zonedToUtc(m[1], m[2], tz).toISOString() }; }   // floating = local
    const d = new Date(`${m[1]}T${m[2]}:00${m[3] === "Z" ? "Z" : m[3].replace(/(\d{2})(\d{2})$/, "$1:$2")}`);
    if (isNaN(+d)) return null;
    const p = localParts(d, tz); return { date: p.date, time: p.time, iso: d.toISOString() };
  }
  const d = new Date(v); if (isNaN(+d)) return null;
  const p = localParts(d, tz); return { date: p.date, time: p.time, iso: d.toISOString() };
}

/* ---------- the app's plan vocabulary (mirror of ui.js:100-115) ---------- */
export function whenBucket(dateStr: string, today: string): string {
  const days = Math.round((Date.parse(dateStr + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 864e5);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  const dow = new Date(dateStr + "T00:00:00Z").getUTCDay();
  if (days <= 7) return (dow === 0 || dow >= 5) ? "this_weekend" : "this_week";
  if (days <= 14) return "next_week";
  return "someday";
}
// expires the day after the event, end of day, in the city's clock
export const dateExpiry = (dateStr: string, tz: string) => new Date(zonedToUtc(dateStr, "23:59", tz).getTime() + 864e5).toISOString();
export function niceTime(t: string | null | undefined): string | null {
  if (!t) return null;
  const [hh, mm] = t.split(":").map(Number);
  const ap = hh >= 12 ? "pm" : "am", h12 = ((hh + 11) % 12) + 1;
  return mm ? `${h12}:${String(mm).padStart(2, "0")}${ap}` : `${h12}${ap}`;
}

/* ---------- category + emoji ---------- */
const RULES: [RegExp, string][] = [
  [/\b(run|5k|10k|marathon|hike|hiking|yoga|pilates|climb|bouldering|bike|cycling|swim|workout|fitness|sports?|tennis|pickleball|basketball|soccer|volleyball)\b/i, "active"],
  [/\b(walk|walking|tour|stroll|birding)\b/i, "walk"],
  [/\b(coffee|café|cafe|espresso|latte)\b/i, "coffee"],
  [/\b(food|dinner|brunch|lunch|tasting|market|supper|pizza|taco|bbq|cook|chef|omakase|potluck|picnic)\b/i, "food"],
  [/\b(bar|cocktail|wine|beer|happy hour|party|club|dj|rooftop|dance|nightlife|rave|disco)\b/i, "drinks"],
  [/\b(comedy|film|movie|screening|reading|talk|panel|gallery|museum|exhibit|book|poetry|theater|theatre|jazz|concert|show|music|listening)\b/i, "chill"],
];
export function guessCategory(categories: string[], title: string): string {
  const hay = [...categories, title].join(" ");
  for (const [re, cat] of RULES) if (re.test(hay)) return cat;
  return "other";
}
export const EMOJI: Record<string, string> = { food: "🍽️", coffee: "☕", drinks: "🍸", active: "🏃", walk: "🌙", chill: "🛋️", other: "✨" };

export const trim = (s: string | null | undefined, n: number) => { const t = (s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };
export const toCents = (v: unknown) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.]/g, "")); return isNaN(n) ? null : Math.round(n * 100); };
