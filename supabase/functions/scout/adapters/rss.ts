// adapters/rss.ts — RSS / Atom feeds. Many civic and venue feeds carry the
// event itself in the item (NYC Parks: event:startdate / starttime / location /
// coordinates); those become items directly. Entries without a usable date
// come back as links for the caller to extract the cheap way.

import { type Item, type CityRow, canonicalUrl, todayIn, zonedToUtc } from "../lib/item.ts";

export type RssEntry = { link: string; item?: Item };

const strip = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
const tag = (x: string, names: string[]) => {
  for (const n of names) {
    const m = x.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${n}>`, "i"));
    if (m && strip(m[1])) return strip(m[1]);
  }
  return "";
};
const attr = (x: string, re: RegExp) => { const m = x.match(re); return m ? m[1] : ""; };

// "7:00 am" / "19:00" / "7pm" → HH:MM
function toTime(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = Number(m[1]); const mm = m[2] || "00"; const ap = (m[3] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0;
  if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${mm}`;
}
// "2026-09-10" / "09/10/2026" / "Sep 10, 2026"
function toDate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(t); if (!isNaN(d.getTime()) && /\d{4}/.test(t)) return d.toISOString().slice(0, 10);
  return null;
}

export function parseRss(text: string, city: CityRow, feedUrl: string, { max = 60 } = {}): RssEntry[] {
  const out: RssEntry[] = [];
  const today = todayIn(city.tz);
  const entries = [...text.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]).slice(0, max);
  for (const x of entries) {
    const link = (tag(x, ["link"]) || attr(x, /<link[^>]+href=["']([^"']+)["']/i) || tag(x, ["guid"])).trim();
    if (!/^https?:\/\//i.test(link)) continue;
    const title = tag(x, ["title"]);
    const date = toDate(tag(x, ["event:startdate", "ev:startdate", "startdate", "start_date", "xcal:dtstart", "dc:date"]));
    if (!title || !date || date < today) { out.push({ link }); continue; }
    const time = toTime(tag(x, ["event:starttime", "ev:starttime", "starttime", "start_time"]));
    const endDate = toDate(tag(x, ["event:enddate", "ev:enddate", "enddate", "end_date"])), endTime = toTime(tag(x, ["event:endtime", "ev:endtime", "endtime", "end_time"]));
    const coords = tag(x, ["event:coordinates", "georss:point", "geo:point"]).split(/[\s,]+/).map(Number).filter((n) => !isNaN(n));
    const cats = tag(x, ["event:categories"]).split("|").map((c) => c.trim()).filter(Boolean).concat([...x.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)].map((m) => strip(m[1])).filter(Boolean));
    const image = tag(x, ["event:image", "image"]) || attr(x, /<(?:enclosure|media:content|media:thumbnail)[^>]+url=["']([^"']+\.(?:jpe?g|png|webp|gif)[^"']*)["']/i);
    const venue = tag(x, ["event:location", "ev:location", "location", "event:parknames"]).replace(/\s*\(in [^)]*\)\s*$/, "");
    const guid = tag(x, ["guid", "id"]);
    const reg = tag(x, ["registration_url"]);
    out.push({ link, item: {
      source: "rss", external_id: guid && !/^https?:/.test(guid) ? `${canonicalUrl(feedUrl)}#${guid}` : canonicalUrl(link), url: canonicalUrl(link),
      title: title.slice(0, 200), description: tag(x, ["description", "summary", "content"]).slice(0, 2000) || null,
      start_date: date, start_time: time, starts_at: zonedToUtc(date, time || "00:00", city.tz).toISOString(),
      ends_at: endDate ? zonedToUtc(endDate, endTime || "23:59", city.tz).toISOString() : null,
      venue_name: venue || null, address: null, lat: coords.length === 2 ? coords[0] : null, lng: coords.length === 2 ? coords[1] : null,
      image_url: /^https?:\/\//i.test(image) ? image : null, price_min_cents: reg ? null : 0, price_max_cents: reg ? null : 0, currency: "USD",
      organizer_name: tag(x, ["author", "dc:creator", "event:organizer"]) || null, organizer_url: null,
      categories: [...new Set(cats)].slice(0, 12), raw: { method: "rss" },
    } });
  }
  return out;
}
