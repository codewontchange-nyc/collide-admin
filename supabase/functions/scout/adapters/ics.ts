// adapters/ics.ts — iCalendar (Luma calendars, Google Calendar public feeds,
// Meetup group feeds, venue calendars). Wall times land in the city's clock.

import { type Item, type CityRow, canonicalUrl, localParts, zonedToUtc, todayIn } from "../lib/item.ts";

type Prop = { name: string; params: Record<string, string>; value: string };

function unfold(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}
function parseProp(line: string): Prop | null {
  const i = line.indexOf(":"); if (i < 0) return null;
  const head = line.slice(0, i), value = line.slice(i + 1);
  const [name, ...ps] = head.split(";");
  const params: Record<string, string> = {};
  for (const p of ps) { const j = p.indexOf("="); if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, ""); }
  return { name: name.toUpperCase(), params, value };
}
const unesc = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");

// DTSTART value + params → city-local parts
function when(p: Prop, tz: string): { date: string; time: string | null; iso: string | null } | null {
  const v = p.value.trim();
  if (p.params.VALUE === "DATE" || /^\d{8}$/.test(v)) return { date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, time: null, iso: null };
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`, time = `${m[4]}:${m[5]}`;
  let inst: Date;
  if (m[7] === "Z") inst = new Date(`${date}T${time}:00Z`);
  else if (p.params.TZID) { try { inst = zonedToUtc(date, time, p.params.TZID); } catch { inst = zonedToUtc(date, time, tz); } }
  else inst = zonedToUtc(date, time, tz);   // floating → the city's clock
  const lp = localParts(inst, tz);
  return { date: lp.date, time: lp.time, iso: inst.toISOString() };
}

export function parseIcs(text: string, city: CityRow, feedUrl: string, { max = 200 } = {}): Item[] {
  const lines = unfold(text);
  const out: Item[] = [];
  let cur: Record<string, Prop> | null = null;
  const today = todayIn(city.tz);
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") {
      if (cur) {
        const st = cur.DTSTART ? when(cur.DTSTART, city.tz) : null;
        const title = unesc(cur.SUMMARY?.value || "").trim();
        if (st && title && st.date >= today) {
          const en = cur.DTEND ? when(cur.DTEND, city.tz) : null;
          const uid = (cur.UID?.value || "").trim();
          const url = (cur.URL?.value || "").trim() || feedUrl;
          const geo = (cur.GEO?.value || "").split(";").map(Number);
          const loc = unesc(cur.LOCATION?.value || "").trim();
          const organizer = cur.ORGANIZER?.params.CN || null;
          out.push({
            source: "ics",
            external_id: uid || canonicalUrl(url) + "#" + st.date,
            url: url,
            title, description: unesc(cur.DESCRIPTION?.value || "").trim() || null,
            start_date: st.date, start_time: st.time, starts_at: st.iso, ends_at: en?.iso || null,
            venue_name: loc ? loc.split(",")[0].trim() : null, address: loc || null,
            lat: geo.length === 2 && !isNaN(geo[0]) ? geo[0] : null, lng: geo.length === 2 && !isNaN(geo[1]) ? geo[1] : null,
            image_url: (cur["ATTACH"]?.value || "").match(/^https?:\/\//) ? cur["ATTACH"].value : null,
            organizer_name: organizer, organizer_url: null,
            categories: (cur.CATEGORIES?.value || "").split(",").map((s) => s.trim()).filter(Boolean),
            raw: { uid, feed: feedUrl },
          });
        }
      }
      cur = null; continue;
    }
    if (cur) { const p = parseProp(line); if (p && !(p.name in cur)) cur[p.name] = p; }
    if (out.length >= max) break;
  }
  return out;
}

export const looksLikeIcs = (text: string, contentType: string) => /text\/calendar/i.test(contentType) || /^\s*BEGIN:VCALENDAR/.test(text);
