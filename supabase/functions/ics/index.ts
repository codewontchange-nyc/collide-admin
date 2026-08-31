// ics — serve any public event as a downloadable calendar file.
//
// GET /functions/v1/ics?event=<activity uuid>
//
// Returns text/calendar (RFC 5545) so "Add to calendar" works in Apple/
// Google/Outlook from a plain link — usable by the app, the console, and
// emails alike. The event id is the capability: only public, unexpired
// events are served. Times are converted from the event city's timezone
// to UTC (DST-aware); date-only events come out as all-day.
//
// Deployed with: supabase functions deploy ics --no-verify-jwt --project-ref pjxvvwcnjjizdtiutpxd

import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const APP_URL = "https://codewontchange-nyc.github.io/Collide/";

const CITY_TZ: Record<string, string> = {
  nyc: "America/New_York", atl: "America/New_York", dc: "America/New_York",
  chi: "America/Chicago", nola: "America/Chicago",
  la: "America/Los_Angeles", sf: "America/Los_Angeles",
};

// local wall time in an IANA zone → UTC Date (DST-aware, no libraries)
function zonedToUtc(dateStr: string, timeStr: string, tz: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const asIf = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
  return new Date(guess + (guess - asIf));
}

const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// RFC 5545 wants lines ≤75 octets, folded with CRLF + space
const fold = (line: string) => {
  const out: string[] = [];
  let s = line;
  while (s.length > 73) { out.push(s.slice(0, 73)); s = " " + s.slice(73); }
  out.push(s);
  return out.join("\r\n");
};

Deno.serve(async (req) => {
  const id = new URL(req.url).searchParams.get("event") || "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("bad event id", { status: 400 });

  const { data: ev } = await admin.from("activities")
    .select("id, title, date, starts_at, at_time, location, place, note, link, city, visibility, expires_at, community_id")
    .eq("id", id).maybeSingle();
  if (!ev || ev.visibility !== "public") return new Response("not found", { status: 404 });
  if (!ev.date && ev.expires_at && new Date(ev.expires_at) < new Date()) return new Response("expired", { status: 410 });

  let communityName = "Collide";
  if (ev.community_id) {
    const { data: c } = await admin.from("communities").select("name").eq("id", ev.community_id).maybeSingle();
    if (c) communityName = c.name;
  }

  const tz = CITY_TZ[ev.city || "nyc"] || "America/New_York";
  const now = utcStamp(new Date());
  // phone-made plans carry a free-text at_time ("11am - 4pm") instead of starts_at
  let startTime = ev.starts_at as string | null;
  let endTime: string | null = null;
  if (!startTime && ev.at_time) {
    const times = [...String(ev.at_time).matchAll(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/gi)]
      .map((m) => {
        let h = +m[1] % 12;
        if (m[3].toLowerCase() === "pm") h += 12;
        return `${String(h).padStart(2, "0")}:${m[2] || "00"}`;
      });
    if (times[0]) startTime = times[0];
    if (times[1]) endTime = times[1];
  }
  let when: string;
  if (ev.date && startTime) {
    const start = zonedToUtc(ev.date, startTime, tz);
    const end = endTime && endTime > startTime
      ? zonedToUtc(ev.date, endTime, tz)
      : new Date(start.getTime() + 2 * 3600e3);   // default 2h
    when = `DTSTART:${utcStamp(start)}\r\nDTEND:${utcStamp(end)}`;
  } else if (ev.date) {
    const d = ev.date.replace(/-/g, "");
    const next = new Date(new Date(ev.date + "T00:00:00Z").getTime() + 864e5).toISOString().slice(0, 10).replace(/-/g, "");
    when = `DTSTART;VALUE=DATE:${d}\r\nDTEND;VALUE=DATE:${next}`;
  } else return new Response("event has no date yet", { status: 422 });

  const descBits = [ev.note, ev.community_id ? `With ${communityName} on Collide.` : "A Collide plan.", ev.link].filter(Boolean);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Collide//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ev.id}@collide`,
    `DTSTAMP:${now}`,
    when,
    fold(`SUMMARY:${esc(ev.title || "Collide plan")}`),
    fold(`DESCRIPTION:${esc(descBits.join("\n"))}`),
    fold(`LOCATION:${esc(ev.location || ev.place || "")}`),
    fold(`URL:${APP_URL}event/${ev.id}`),
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const body = lines.join("\r\n") + "\r\n";
  const fname = ((ev.title || "collide-event").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "collide-event") + ".ics";
  return new Response(body, { headers: {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `attachment; filename="${fname}"`,
    "Cache-Control": "public, max-age=300",
    "Access-Control-Allow-Origin": "*",
  }});
});
