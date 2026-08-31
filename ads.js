import { useState, useRef } from "https://esm.sh/preact@10.23.2/hooks";
import { html } from "./ui.js?v=30";

/* Ads — the funnel toolkit. Pick a format (standard social + web sizes) and
   a message, preview it in the real brand system, download a true-size PNG,
   and compose UTM-tagged deeplinks. Ads are pure DOM/CSS (no images), so
   the PNG capture is deterministic. */

const SITE = "https://codewontchange-nyc.github.io/collide-site/";
const APP = "https://codewontchange-nyc.github.io/Collide/";

const FORMATS = [
  { key: "sq", name: "Square", w: 1080, h: 1080, use: "IG/FB feed" },
  { key: "por", name: "Portrait", w: 1080, h: 1350, use: "IG feed (tall)" },
  { key: "story", name: "Story", w: 1080, h: 1920, use: "IG story · Reels · TikTok" },
  { key: "land", name: "Landscape", w: 1200, h: 628, use: "FB/LinkedIn link ads" },
  { key: "x", name: "X post", w: 1600, h: 900, use: "X/Twitter" },
  { key: "og", name: "OG card", w: 1200, h: 630, use: "link previews" },
  { key: "lead", name: "Leaderboard", w: 728, h: 90, use: "web display" },
  { key: "rect", name: "Med rectangle", w: 300, h: 250, use: "web display" },
];

const VARIANTS = [
  { key: "brand", label: "Always something", head: "Always something to look forward to.", sub: "Casual plans & small communities, on a hand-drawn map of your city.", cta: "Sign up — it's free" },
  { key: "people", label: "Find your people", head: "Find your people in the city.", sub: "Six to eight friends who always include you.", cta: "Join Collide" },
  { key: "alive", label: "Quote · alive again", head: "“My city feels alive again.”", sub: "— Maya F., member since June", cta: "See why", quote: true },
  { key: "invites", label: "Quote · invites", head: "“I don't miss invites to things anymore.”", sub: "— Jules R., month two", cta: "Get on the map", quote: true },
  { key: "nyc", label: "NYC live", head: "New York is live.", sub: "The map is drawn. The plans are real.", cta: "Come meet the city" },
  { key: "atl", label: "ATL teaser", head: "Atlanta, you're next.", sub: "The cartographer is inking Peachtree…", cta: "Get early access" },
];

const ASSETS = [
  { name: "Sample map art", url: SITE + "map.jpg" },
  { name: "App screen · map", url: SITE + "shot-map.jpg" },
  { name: "App screen · up next", url: SITE + "shot-upnext.jpg" },
  { name: "App screen · chat", url: SITE + "shot-chat.jpg" },
  { name: "Avatar · Maya", url: SITE + "av-maya.png" },
  { name: "Avatar · Andre", url: SITE + "av-andre.png" },
];

/* one ad component, layout adapts to the canvas shape */
function Ad({ f, v }) {
  const { w, h } = f;
  const m = Math.min(w, h);
  const banner = h <= 300;                          // leaderboard / rectangle
  const strip = banner && w / h > 4;                // leaderboard
  const px = (n) => n + "px";
  const dot = (size, color, ml) => html`<span style=${`width:${px(size)};height:${px(size)};border-radius:50%;background:${color};display:inline-block;${ml ? `margin-left:-${px(size * 0.4)};opacity:.85` : ""}`}></span>`;
  const dots = (size) => html`<span style="display:inline-flex;vertical-align:middle">${dot(size, "#e85d75")}${dot(size, "#219a8f", true)}</span>`;

  if (strip) {
    return html`<div style=${`width:${px(w)};height:${px(h)};background:#fbf6f0;border:2px solid #241d1a;display:flex;align-items:center;gap:${px(m * 0.18)};padding:0 ${px(m * 0.3)};box-sizing:border-box;overflow:hidden`}>
      ${dots(m * 0.42)}
      <span style=${`font:500 ${px(m * 0.42)}/1 'Cormorant Garamond',serif`}>collide</span>
      <span style=${`font:400 ${px(m * 0.3)}/1.1 Lacquer,cursive;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`}>${v.head}</span>
      <span style=${`background:#e85d75;color:#fff;font:700 ${px(m * 0.24)}/1 Inter;padding:${px(m * 0.16)} ${px(m * 0.3)};border-radius:999px;white-space:nowrap`}>${v.cta}</span>
    </div>`;
  }
  if (banner) {
    return html`<div style=${`width:${px(w)};height:${px(h)};background:#fbf6f0;border:2px solid #241d1a;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${px(h * 0.05)};padding:${px(h * 0.06)};box-sizing:border-box;text-align:center;overflow:hidden`}>
      <div>${dots(h * 0.11)} <span style=${`font:500 ${px(h * 0.12)}/1 'Cormorant Garamond',serif;vertical-align:middle`}> collide</span></div>
      <div style=${`font:400 ${px(h * 0.11)}/1.15 Lacquer,cursive`}>${v.head}</div>
      <div style=${`background:#e85d75;color:#fff;font:700 ${px(h * 0.075)}/1 Inter;padding:${px(h * 0.045)} ${px(h * 0.1)};border-radius:999px`}>${v.cta}</div>
    </div>`;
  }
  // posters: square / portrait / story / landscape / og / x
  const tall = h / w > 1.4;
  return html`<div style=${`width:${px(w)};height:${px(h)};background:#fbf6f0;box-sizing:border-box;padding:${px(m * 0.07)};display:flex;overflow:hidden`}>
    <div style=${`flex:1;border:${px(Math.max(2, m * 0.004))} solid #241d1a;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:${px(m * 0.06)};gap:${px(m * (tall ? 0.035 : 0.028))};position:relative`}>
      <div style=${`font:600 ${px(m * 0.021)}/1 Inter;letter-spacing:.3em;color:#8a7e75;text-transform:uppercase`}>est. 2026 · find your people</div>
      <div>${dots(m * 0.055)}</div>
      <div style=${`font:500 ${px(m * 0.085)}/1 'Cormorant Garamond',serif`}>collide</div>
      <div style=${`border-top:${px(Math.max(2, m * 0.005))} double #241d1a;width:55%`}></div>
      <div style=${`font:400 ${px(m * (v.quote ? 0.075 : 0.082))}/1.2 Lacquer,cursive;max-width:92%`}>${v.head}</div>
      <div style=${`font:italic 500 ${px(m * 0.036)}/1.4 'Cormorant Garamond',serif;color:#5c534d;max-width:80%`}>${v.sub}</div>
      <div style=${`background:#e85d75;color:#fff;font:700 ${px(m * 0.036)}/1 Inter;padding:${px(m * 0.026)} ${px(m * 0.06)};border-radius:999px;margin-top:${px(m * 0.01)}`}>${v.cta}</div>
      <div style=${`position:absolute;bottom:${px(m * 0.035)};font:600 ${px(m * 0.02)}/1 Inter;letter-spacing:.18em;color:#c9bfb4;text-transform:uppercase`}>collide.city</div>
    </div>
  </div>`;
}

export function AdsPage({ flash }) {
  const [fkey, setFkey] = useState("sq");
  const [vkey, setVkey] = useState("brand");
  const [dest, setDest] = useState(SITE);
  const [src, setSrc] = useState("instagram");
  const [camp, setCamp] = useState("sept-launch");
  const [busy, setBusy] = useState(false);
  const captureRef = useRef(null);

  const f = FORMATS.find((x) => x.key === fkey);
  const v = VARIANTS.find((x) => x.key === vkey);
  const scale = Math.min(560 / f.w, 480 / f.h, 1);
  const link = `${dest}${dest.includes("?") ? "&" : "?"}utm_source=${src}&utm_medium=${src === "web" ? "display" : "paid"}&utm_campaign=${encodeURIComponent(camp || "launch")}`;

  const copy = (t, msg) => { navigator.clipboard?.writeText(t); flash(msg); };

  const download = async () => {
    setBusy(true);
    try {
      const { default: html2canvas } = await import("https://esm.sh/html2canvas@1.4.1");
      const canvas = await html2canvas(captureRef.current.firstChild, { backgroundColor: null, scale: 1, logging: false });
      const a = document.createElement("a");
      a.download = `collide-${vkey}-${f.w}x${f.h}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
      flash("PNG downloaded 🖼");
    } catch (e) { flash("Capture failed: " + (e.message || e)); }
    setBusy(false);
  };

  return html`<div class="page">
    <div class="pagehead">
      <h2>Ads <span class="muted" style="font:400 13px var(--body)">funnel creative — pick a format, download the asset, copy the link</span></h2>
    </div>

    <div class="ads-grid">
      <div>
        <div class="section-label">Format</div>
        <div class="ads-formats">
          ${FORMATS.map((x) => html`<button class=${"ads-format" + (fkey === x.key ? " on" : "")} onClick=${() => setFkey(x.key)}>
            <b>${x.name}</b><span>${x.w}×${x.h}</span><i>${x.use}</i>
          </button>`)}
        </div>

        <div class="section-label" style="margin-top:18px">Message</div>
        <div class="subnav" style="margin-bottom:0;flex-wrap:wrap">
          ${VARIANTS.map((x) => html`<button class=${vkey === x.key ? "on" : ""} onClick=${() => setVkey(x.key)}>${x.label}</button>`)}
        </div>

        <div class="section-label" style="margin-top:18px">Deeplink</div>
        <div class="card" style="padding:12px 14px">
          <div class="field"><label>Destination</label>
            <select value=${dest} onChange=${(e) => setDest(e.target.value)}>
              <option value=${SITE}>Landing site</option>
              <option value=${APP}>App (sign up)</option>
            </select></div>
          <div class="fieldrow">
            <div class="field"><label>Source</label>
              <select value=${src} onChange=${(e) => setSrc(e.target.value)}>
                ${["instagram", "facebook", "x", "tiktok", "web"].map((s) => html`<option value=${s}>${s}</option>`)}
              </select></div>
            <div class="field"><label>Campaign</label>
              <input value=${camp} onInput=${(e) => setCamp(e.target.value)} /></div>
          </div>
          <div class="ads-link" onClick=${() => copy(link, "Link copied 🔗")} title="Click to copy">${link}</div>
          <p class="tiny muted" style="margin:6px 0 0">Per-community deeplinks: <code>${APP}c/‹community-id›</code> · per-event: <code>${APP}event/‹event-id›</code> — grab ids from the Data tab.</p>
        </div>

        <div class="section-label" style="margin-top:18px">Brand asset kit</div>
        <div class="card" style="padding:8px 14px">
          ${ASSETS.map((a) => html`<div class="ads-asset">
            <span>${a.name}</span>
            <span style="display:flex;gap:6px">
              <a class="btn small ghost" style="text-decoration:none" href=${a.url} target="_blank">open</a>
              <button class="btn small ghost" onClick=${() => copy(a.url, "Asset URL copied")}>copy url</button>
            </span>
          </div>`)}
        </div>
      </div>

      <div>
        <div class="section-label">Preview · ${f.w}×${f.h}</div>
        <div class="ads-stage">
          <div style=${`width:${f.w * scale}px;height:${f.h * scale}px;overflow:hidden`}>
            <div style=${`transform:scale(${scale});transform-origin:top left`}><${Ad} f=${f} v=${v} /></div>
          </div>
        </div>
        <div style="display:flex;gap:10px;margin-top:12px">
          <button class="btn" disabled=${busy} onClick=${download}>${busy ? "Rendering…" : `⬇ Download PNG (${f.w}×${f.h})`}</button>
          <button class="btn ghost" onClick=${() => copy(link, "Link copied 🔗")}>Copy ad link</button>
        </div>
        <p class="tiny muted" style="margin-top:8px">PNG renders at true size from the live template — same type, same ink, no screenshots.</p>
      </div>
    </div>

    <div ref=${captureRef} style="position:fixed;left:-99999px;top:0"><${Ad} f=${f} v=${v} /></div>
  </div>`;
}
