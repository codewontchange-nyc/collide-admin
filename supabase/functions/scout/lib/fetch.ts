// lib/fetch.ts — bounded, polite fetches. Named UA, 8 s timeout, byte caps.
// (Same manners as the venue og:image scrape in the app's nav function.)

export const UA = "Mozilla/5.0 (compatible; CollideBot/1.0; +https://codewontchange-nyc.github.io/collide-site/)";

async function readCapped(resp: Response, max: number): Promise<Uint8Array> {
  const reader = resp.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let n = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { try { await reader.cancel(); } catch { /* ignore */ } throw new Error("too_large"); }
    chunks.push(value);
  }
  const out = new Uint8Array(n); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export async function fetchText(url: string, { maxBytes = 2_000_000, timeout = 8000, accept = "text/html,application/xhtml+xml,text/calendar,application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.8" } = {}) {
  const resp = await fetch(url, { headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(timeout) });
  const bytes = await readCapped(resp, maxBytes);
  return { status: resp.status, ok: resp.ok, contentType: resp.headers.get("content-type") || "", text: new TextDecoder("utf-8", { fatal: false }).decode(bytes), finalUrl: resp.url || url };
}

export async function fetchImage(url: string, { maxBytes = 5_000_000, timeout = 8000 } = {}) {
  const resp = await fetch(url, { headers: { "User-Agent": UA, Accept: "image/*" }, redirect: "follow", signal: AbortSignal.timeout(timeout) });
  const ct = resp.headers.get("content-type") || "";
  if (!resp.ok || !ct.startsWith("image/")) throw new Error(`not_image:${resp.status}`);
  const len = Number(resp.headers.get("content-length") || 0);
  if (len > maxBytes) throw new Error("too_large");
  const bytes = await readCapped(resp, maxBytes);
  const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : ct.includes("gif") ? "gif" : "jpg";
  return { bytes, contentType: ct.split(";")[0], ext };
}

// strip everything a reader wouldn't see, collapse whitespace, cap length
export function visibleText(html: string, cap = 12_000): string {
  const t = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article|header|footer)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  return t.length > cap ? t.slice(0, cap) : t;
}
